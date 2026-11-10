import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  accountBalances,
  approvePayment,
  beneficiaryMatch,
  compactIban,
  createPayment,
  failPayment,
  isValidIban,
  nameSimilarity,
  normalizeArabic,
  rejectPayment,
  reversePayment,
  runChecks,
  screenPayment,
  settlePayment,
  submitPayment,
  toLatinDigits,
  validatePayment,
  verifyAudit,
  type KernelCtx,
  type User,
  type World,
} from '../domain/index.js';
import { newId, sha256 } from '../services/crypto.js';
import { seedWorld } from '../domain/seed.js';
import type { Repository } from '../services/store.js';
import { CreatePaymentBody, FailBody, NormalizeBody, NoteBody } from './schemas.js';

function ctx(world: World, actor: User): KernelCtx {
  return { world, actor, now: () => new Date().toISOString(), id: newId, hash: sha256 };
}

function summary(world: World) {
  const count = (status: string) => world.payments.filter((p) => p.status === status).length;
  return {
    tenant: { id: world.tenantId, name: world.tenantName },
    totals: {
      payments: world.payments.length,
      initiated: count('initiated'),
      validated: count('validated'),
      screened: count('screened'),
      submitted: count('submitted'),
      settled: count('settled'),
      failed: count('failed'),
      reversed: count('reversed'),
      pendingApproval: world.payments.filter((p) => p.approvalStatus === 'pending').length,
      openRuleHits: world.hits.filter((h) => {
        const p = world.payments.find((x) => x.id === h.paymentId);
        return p && !['failed', 'reversed', 'settled'].includes(p.status);
      }).length,
    },
    balances: accountBalances(world.journals),
  };
}

export async function routes(app: FastifyInstance, repo: Repository) {
  app.get('/api/v1/me', { schema: { tags: ['session'] } }, async (req) => {
    return repo.read((w) => ({ user: req.actorUser, tenant: { id: w.tenantId, name: w.tenantName }, users: w.users }));
  });

  app.get('/api/v1/summary', { schema: { tags: ['reports'] } }, async () => repo.read(summary));

  app.get('/api/v1/payments', { schema: { tags: ['payments'] } }, async () => repo.read((w) => ({ payments: w.payments })));

  app.get<{ Params: { id: string } }>('/api/v1/payments/:id', { schema: { tags: ['payments'] } }, async (req, reply) => {
    return repo.read((w) => {
      const payment = w.payments.find((p) => p.id === req.params.id);
      if (!payment) return reply.code(404).send({ error: 'not_found', message: 'payment not found' });
      return {
        payment,
        hits: w.hits.filter((h) => h.paymentId === payment.id),
        journals: w.journals.filter((j) => j.paymentId === payment.id),
      };
    });
  });

  app.post('/api/v1/payments', {
    schema: { tags: ['payments'], body: CreatePaymentBody },
  }, async (req) => {
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim() || newId('idem');
    return repo.write(async (w) => createPayment(ctx(w, req.actorUser), { ...(req.body as any), idempotencyKey }));
  });

  const action = (path: string, fn: (c: KernelCtx, id: string, body: any) => Promise<unknown>) => {
    app.post<{ Params: { id: string } }>(path, { schema: { tags: ['payments'], body: Type.Optional(NoteBody) } }, async (req) => {
      return repo.write((w) => fn(ctx(w, req.actorUser), req.params.id, req.body ?? {}));
    });
  };

  action('/api/v1/payments/:id/validate', (c, id) => validatePayment(c, id).then((payment) => ({ payment })));
  action('/api/v1/payments/:id/screen', (c, id) => screenPayment(c, id));
  action('/api/v1/payments/:id/checks', (c, id) => runChecks(c, id));
  action('/api/v1/payments/:id/approve', (c, id, body) => approvePayment(c, id, body.note ?? '').then((payment) => ({ payment })));
  action('/api/v1/payments/:id/reject', (c, id, body) => rejectPayment(c, id, body.note ?? '').then((payment) => ({ payment })));
  action('/api/v1/payments/:id/submit', (c, id) => submitPayment(c, id).then((payment) => ({ payment })));
  action('/api/v1/payments/:id/settle', (c, id) => settlePayment(c, id).then((payment) => ({ payment })));

  app.post<{ Params: { id: string } }>('/api/v1/payments/:id/fail', {
    schema: { tags: ['payments'], body: FailBody },
  }, async (req) => repo.write(async (w) => ({ payment: await failPayment(ctx(w, req.actorUser), req.params.id, (req.body as any)?.reason ?? '') })));

  app.post<{ Params: { id: string } }>('/api/v1/payments/:id/reverse', {
    schema: { tags: ['payments'], body: FailBody },
  }, async (req) => repo.write(async (w) => ({ payment: await reversePayment(ctx(w, req.actorUser), req.params.id, (req.body as any)?.reason ?? '') })));

  app.get('/api/v1/ledger', { schema: { tags: ['ledger'] } }, async () =>
    repo.read((w) => ({ journals: w.journals, balances: accountBalances(w.journals) })),
  );

  app.get('/api/v1/rules', { schema: { tags: ['rules'] } }, async () =>
    repo.read((w) => ({
      hits: w.hits.map((h) => ({ ...h, payment: w.payments.find((p) => p.id === h.paymentId) ?? null })),
    })),
  );

  app.get('/api/v1/audit', { schema: { tags: ['audit'] } }, async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 500);
    return repo.read((w) => ({ entries: w.audit.slice(-limit).reverse() }));
  });

  app.get('/api/v1/audit/verify', { schema: { tags: ['audit'] } }, async () => repo.read((w) => verifyAudit(w, sha256)));

  app.post('/api/v1/normalize', { schema: { tags: ['util'], body: NormalizeBody, security: [] } }, async (req) => {
    const body = req.body as { name: string; otherName?: string; iban?: string };
    return repo.read((w) => {
      const iban = body.iban ? compactIban(body.iban) : '';
      return {
        latinDigits: toLatinDigits(body.name),
        normalized: normalizeArabic(body.name),
        validIban: body.iban ? isValidIban(body.iban) : null,
        compactIban: body.iban ? iban : null,
        nameSimilarity: body.otherName ? nameSimilarity(body.name, body.otherName) : null,
        beneficiary: body.iban ? beneficiaryMatch(w, body.name, body.iban) : null,
      };
    });
  });

  app.post('/api/v1/demo/reset', { schema: { tags: ['session'] } }, async (req) => {
    if (req.actorUser.role !== 'admin') {
      return { error: 'forbidden', message: 'only admin can reset the demo' };
    }
    return repo.write(async (w) => {
      const next = await seedWorld(sha256);
      Object.assign(w, next);
      return { ok: true, payments: w.payments.length };
    });
  });
}
