import { compactIban, isValidIban, normalizeArabic, nameSimilarity } from './arabic.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from './errors.js';
import { invertLines, planSubmission } from './ledger.js';
import { assertTransition } from './machine.js';
import { MoneyError, parseAmountToMinor } from './money.js';
import { evaluateRules, highestSeverity } from './rules.js';
import {
  APPROVAL_THRESHOLD_MINOR,
  INSTANT_FEE_MINOR,
  type CreatePaymentInput,
  type JournalEntry,
  type PaymentInstruction,
  type Role,
  type RuleHit,
  type User,
  type World,
} from './types.js';

export interface KernelCtx {
  world: World;
  actor: User;
  now: () => string;
  id: (prefix: string) => string;
  hash: (s: string) => Promise<string>;
}

const WRITE: Record<string, Role[]> = {
  create: ['maker', 'admin'],
  validate: ['maker', 'admin'],
  screen: ['maker', 'checker', 'admin'],
  approve: ['checker', 'admin'],
  reject: ['checker', 'admin'],
  submit: ['maker', 'admin'],
  settle: ['admin'],
  fail: ['admin'],
  reverse: ['admin'],
};

function requireRole(actor: User, action: keyof typeof WRITE) {
  if (!WRITE[action].includes(actor.role)) throw unauthorized(`role ${actor.role} cannot ${action}`);
}

function paymentOrThrow(world: World, id: string): PaymentInstruction {
  const p = world.payments.find((x) => x.id === id);
  if (!p) throw notFound(`payment ${id} not found`);
  return p;
}

const GENESIS = '0'.repeat(64);

async function appendAudit(
  ctx: KernelCtx,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const prev = ctx.world.audit.at(-1);
  const seq = (prev?.seq ?? 0) + 1;
  const createdAt = ctx.now();
  const id = ctx.id('aud');
  const base = {
    id,
    tenantId: ctx.world.tenantId,
    actor: `${ctx.actor.username}:${ctx.actor.role}`,
    action,
    entityType,
    entityId,
    details,
    createdAt,
  };
  const hash = await ctx.hash([prev?.hash ?? GENESIS, id, base.actor, action, entityType, entityId ?? '', JSON.stringify(details), createdAt].join('|'));
  ctx.world.audit.push({ ...base, seq, hash });
}

function touch(p: PaymentInstruction, now: string) {
  p.updatedAt = now;
}

function needsApproval(p: PaymentInstruction, hits: Array<{ severity: string }>): boolean {
  if (p.amountMinor >= APPROVAL_THRESHOLD_MINOR[p.currency]) return true;
  if (hits.some((h) => h.severity === 'warn' || h.severity === 'block')) return true;
  return false;
}

export async function createPayment(ctx: KernelCtx, input: CreatePaymentInput): Promise<{ payment: PaymentInstruction; replayed: boolean }> {
  requireRole(ctx.actor, 'create');
  let amountMinor: number;
  try {
    amountMinor = parseAmountToMinor(input.amount);
  } catch (e) {
    throw badRequest(e instanceof MoneyError ? e.message : 'invalid amount');
  }
  if (amountMinor <= 0) throw badRequest('amount must be positive');

  const existingId = ctx.world.idempotency[input.idempotencyKey];
  if (existingId) {
    const existing = paymentOrThrow(ctx.world, existingId);
    const same =
      existing.kind === input.kind &&
      existing.currency === input.currency &&
      existing.amountMinor === amountMinor &&
      existing.debtorIban === compactIban(input.debtorIban) &&
      existing.creditorIban === compactIban(input.creditorIban) &&
      existing.reference === input.reference.trim();
    if (!same) throw conflict('idempotency key reused with a different payload', { paymentId: existing.id });
    return { payment: existing, replayed: true };
  }

  const now = ctx.now();
  const p: PaymentInstruction = {
    id: ctx.id('pmt'),
    tenantId: ctx.world.tenantId,
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    status: 'initiated',
    amountMinor,
    feeMinor: input.kind === 'instant_credit' ? INSTANT_FEE_MINOR[input.currency] : 0,
    currency: input.currency,
    debtorName: input.debtorName.trim(),
    debtorIban: compactIban(input.debtorIban),
    creditorName: input.creditorName.trim(),
    creditorIban: compactIban(input.creditorIban),
    creditorNameNormalized: normalizeArabic(input.creditorName.trim()),
    reference: input.reference.trim(),
    narrative: (input.narrative ?? '').trim(),
    purpose: (input.purpose ?? '').trim(),
    createdBy: ctx.actor.id,
    approvedBy: null,
    rejectedBy: null,
    approvalStatus: 'not_required',
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!p.debtorName || !p.creditorName || !p.reference) throw badRequest('debtor, creditor and reference are required');
  ctx.world.payments.push(p);
  ctx.world.idempotency[input.idempotencyKey] = p.id;
  await appendAudit(ctx, 'payment.created', 'payment', p.id, { kind: p.kind, amountMinor, currency: p.currency, idempotencyKey: p.idempotencyKey });
  return { payment: p, replayed: false };
}

export async function validatePayment(ctx: KernelCtx, id: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'validate');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'validated') return p;
  assertTransition(p.status, 'validated');
  const problems: string[] = [];
  if (!isValidIban(p.debtorIban)) problems.push('debtor IBAN failed the checksum');
  if (!isValidIban(p.creditorIban)) problems.push('creditor IBAN failed the checksum');
  if (p.debtorIban === p.creditorIban) problems.push('debtor and creditor IBAN must differ');
  if (p.amountMinor <= 0) problems.push('amount must be positive');
  if (problems.length) {
    assertTransition(p.status, 'failed');
    p.status = 'failed';
    p.failureReason = problems.join('; ');
    touch(p, ctx.now());
    await appendAudit(ctx, 'payment.failed', 'payment', p.id, { stage: 'validated', reason: p.failureReason });
    return p;
  }
  p.status = 'validated';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.validated', 'payment', p.id, {});
  return p;
}

export async function screenPayment(ctx: KernelCtx, id: string): Promise<{ payment: PaymentInstruction; hits: RuleHit[] }> {
  requireRole(ctx.actor, 'screen');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'screened') return { payment: p, hits: ctx.world.hits.filter((h) => h.paymentId === p.id) };
  assertTransition(p.status, 'screened');
  const now = ctx.now();
  const planned = evaluateRules(ctx.world, p, now);
  const hits: RuleHit[] = planned.map((h) => ({
    id: ctx.id('hit'),
    tenantId: ctx.world.tenantId,
    paymentId: p.id,
    code: h.code,
    severity: h.severity,
    messageAr: h.messageAr,
    messageEn: h.messageEn,
    createdAt: now,
  }));
  ctx.world.hits.push(...hits);
  p.status = 'screened';
  p.approvalStatus = needsApproval(p, hits) ? 'pending' : 'not_required';
  touch(p, now);
  await appendAudit(ctx, 'payment.screened', 'payment', p.id, {
    hits: hits.map((h) => ({ code: h.code, severity: h.severity })),
    approvalStatus: p.approvalStatus,
  });
  return { payment: p, hits };
}

export async function approvePayment(ctx: KernelCtx, id: string, note = ''): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'approve');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status !== 'screened') throw conflict(`cannot approve a payment in status ${p.status}`);
  if (p.approvalStatus === 'approved' || p.approvalStatus === 'not_required') return p;
  if (p.createdBy === ctx.actor.id) throw unauthorized('maker cannot approve their own instruction (four-eyes)');
  p.approvalStatus = 'approved';
  p.approvedBy = ctx.actor.id;
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.approved', 'payment', p.id, { note });
  return p;
}

export async function rejectPayment(ctx: KernelCtx, id: string, note: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'reject');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status !== 'screened') throw conflict(`cannot reject a payment in status ${p.status}`);
  if (p.createdBy === ctx.actor.id) throw unauthorized('maker cannot reject their own instruction (four-eyes)');
  assertTransition(p.status, 'failed');
  p.status = 'failed';
  p.approvalStatus = 'rejected';
  p.rejectedBy = ctx.actor.id;
  p.failureReason = note || 'rejected by checker';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.rejected', 'payment', p.id, { note: p.failureReason });
  return p;
}

function postJournal(ctx: KernelCtx, p: PaymentInstruction, reason: string, lines: JournalEntry['lines']): JournalEntry {
  const entry: JournalEntry = {
    id: ctx.id('jnl'),
    tenantId: ctx.world.tenantId,
    paymentId: p.id,
    reason,
    postedAt: ctx.now(),
    postedBy: ctx.actor.id,
    lines,
  };
  ctx.world.journals.push(entry);
  return entry;
}

export async function submitPayment(ctx: KernelCtx, id: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'submit');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'submitted') return p;
  assertTransition(p.status, 'submitted');
  const hits = ctx.world.hits.filter((h) => h.paymentId === p.id);
  if (highestSeverity(hits) === 'block') {
    throw conflict('cannot submit a payment with a blocking rule hit');
  }
  if (p.approvalStatus === 'pending') throw conflict('checker approval is still pending');
  if (p.approvalStatus === 'rejected') throw conflict('payment was rejected by a checker');
  const journal = postJournal(ctx, p, 'submit', planSubmission(p));
  p.status = 'submitted';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.submitted', 'payment', p.id, { journalId: journal.id });
  return p;
}

export async function settlePayment(ctx: KernelCtx, id: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'settle');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'settled') return p;
  assertTransition(p.status, 'settled');
  p.status = 'settled';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.settled', 'payment', p.id, {});
  return p;
}

export async function failPayment(ctx: KernelCtx, id: string, reason: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'fail');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'failed') return p;
  assertTransition(p.status, 'failed');
  if (p.status === 'submitted') {
    const original = ctx.world.journals.filter((j) => j.paymentId === p.id && j.reason === 'submit').at(-1);
    if (original) postJournal(ctx, p, 'fail_reversal', invertLines(original.lines));
  }
  p.status = 'failed';
  p.failureReason = reason || 'failed by operator';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.failed', 'payment', p.id, { reason: p.failureReason });
  return p;
}

export async function reversePayment(ctx: KernelCtx, id: string, reason: string): Promise<PaymentInstruction> {
  requireRole(ctx.actor, 'reverse');
  const p = paymentOrThrow(ctx.world, id);
  if (p.status === 'reversed') return p;
  assertTransition(p.status, 'reversed');
  const original = ctx.world.journals.filter((j) => j.paymentId === p.id && j.reason === 'submit').at(-1);
  if (original) postJournal(ctx, p, 'reversal', invertLines(original.lines));
  p.status = 'reversed';
  p.failureReason = reason || 'reversed after settlement';
  touch(p, ctx.now());
  await appendAudit(ctx, 'payment.reversed', 'payment', p.id, { reason: p.failureReason });
  return p;
}

/** Convenience: validate then screen (skips screen if validation failed). */
export async function runChecks(ctx: KernelCtx, id: string): Promise<{ payment: PaymentInstruction; hits: RuleHit[] }> {
  const after = await validatePayment(ctx, id);
  if (after.status !== 'validated') return { payment: after, hits: [] };
  return screenPayment(ctx, id);
}

export function verifyAuditChain(world: World, expected: string[]): { valid: boolean; entries: number; brokenAt: number | null } {
  for (let i = 0; i < world.audit.length; i++) {
    if (world.audit[i].hash !== expected[i]) return { valid: false, entries: world.audit.length, brokenAt: i };
  }
  return { valid: true, entries: world.audit.length, brokenAt: null };
}

export function auditChainInputs(world: World): string[] {
  return world.audit.map((e, i) => {
    const prev = i === 0 ? GENESIS : world.audit[i - 1].hash;
    return [prev, e.id, e.actor, e.action, e.entityType, e.entityId ?? '', JSON.stringify(e.details ?? {}), e.createdAt].join('|');
  });
}

export async function verifyAudit(world: World, hash: (s: string) => Promise<string>): Promise<{ valid: boolean; entries: number; brokenAt: number | null }> {
  const expected: string[] = [];
  for (const input of auditChainInputs(world)) expected.push(await hash(input));
  return verifyAuditChain(world, expected);
}

export function beneficiaryMatch(world: World, name: string, iban: string): { score: number; onFile: string | null } {
  const known = world.beneficiaries.find((b) => b.iban === compactIban(iban));
  if (!known) return { score: 0, onFile: null };
  const score = Math.max(nameSimilarity(name, known.nameAr), nameSimilarity(name, known.nameEn));
  return { score, onFile: known.nameEn };
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
