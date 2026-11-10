import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { JournalLine, PaymentInstruction, World } from '../domain/index.js';

export interface Store {
  kind: 'memory' | 'postgres';
  load(): Promise<World>;
  save(world: World): Promise<void>;
}

export function memoryStore(initial: World): Store {
  let world = initial;
  return {
    kind: 'memory',
    async load() {
      return world;
    },
    async save(next) {
      world = next;
    },
  };
}

export async function openPostgresStore(url: string, seed: () => Promise<World>): Promise<Store> {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(dir, '..', 'db', 'migrations', '001_init.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM tenants');
  if (rows[0].c === 0) {
    const world = await seed();
    await persist(pool, world);
  }
  return {
    kind: 'postgres',
    async load() {
      return hydrate(pool);
    },
    async save(world) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await persist(client, world);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult> };

async function persist(q: Queryable, world: World): Promise<void> {
  const t = world.tenantId;
  await q.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update');
  await q.query('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = $1)', [t]);
  await q.query('DELETE FROM journal_entries WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM rule_hits WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM audit_log WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM payments WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM beneficiaries WHERE tenant_id = $1', [t]);
  await q.query('DELETE FROM users WHERE tenant_id = $1', [t]);
  await q.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name', [world.tenantId, world.tenantName]);

  for (const u of world.users) {
    await q.query(
      'INSERT INTO users (id, tenant_id, username, name_ar, name_en, role) VALUES ($1,$2,$3,$4,$5,$6)',
      [u.id, t, u.username, u.nameAr, u.nameEn, u.role],
    );
  }
  for (const b of world.beneficiaries) {
    await q.query('INSERT INTO beneficiaries (tenant_id, iban, name_ar, name_en) VALUES ($1,$2,$3,$4)', [t, b.iban, b.nameAr, b.nameEn]);
  }
  for (const p of world.payments) {
    await q.query(
      `INSERT INTO payments (
        id, tenant_id, idempotency_key, kind, status, amount_minor, fee_minor, currency,
        debtor_name, debtor_iban, creditor_name, creditor_iban, creditor_name_normalized,
        reference, narrative, purpose, created_by, approved_by, rejected_by, approval_status,
        failure_reason, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        p.id, t, p.idempotencyKey, p.kind, p.status, p.amountMinor, p.feeMinor, p.currency,
        p.debtorName, p.debtorIban, p.creditorName, p.creditorIban, p.creditorNameNormalized,
        p.reference, p.narrative, p.purpose, p.createdBy, p.approvedBy, p.rejectedBy, p.approvalStatus,
        p.failureReason, p.createdAt, p.updatedAt,
      ],
    );
  }
  for (const [key, paymentId] of Object.entries(world.idempotency)) {
    await q.query('INSERT INTO idempotency_keys (tenant_id, key, payment_id) VALUES ($1,$2,$3)', [t, key, paymentId]);
  }
  for (const j of world.journals) {
    await q.query(
      'INSERT INTO journal_entries (id, tenant_id, payment_id, reason, posted_at, posted_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [j.id, t, j.paymentId, j.reason, j.postedAt, j.postedBy],
    );
    for (let i = 0; i < j.lines.length; i++) {
      const line = j.lines[i];
      await q.query(
        'INSERT INTO journal_lines (entry_id, line_no, account, debit_minor, credit_minor, currency) VALUES ($1,$2,$3,$4,$5,$6)',
        [j.id, i + 1, line.account, line.debitMinor, line.creditMinor, line.currency],
      );
    }
  }
  for (const h of world.hits) {
    await q.query(
      'INSERT INTO rule_hits (id, tenant_id, payment_id, code, severity, message_ar, message_en, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [h.id, t, h.paymentId, h.code, h.severity, h.messageAr, h.messageEn, h.createdAt],
    );
  }
  try {
    for (const a of world.audit) {
      await q.query(
        `INSERT INTO audit_log (id, tenant_id, seq, actor, action, entity_type, entity_id, details, created_at, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.id, t, a.seq, a.actor, a.action, a.entityType, a.entityId, a.details, a.createdAt, a.hash],
      );
    }
  } finally {
    await q.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update');
  }
}

async function hydrate(q: Queryable): Promise<World> {
  const tenant = (await q.query('SELECT id, name FROM tenants LIMIT 1')).rows[0];
  if (!tenant) throw new Error('no tenant in database');
  const t = tenant.id as string;
  const users = (await q.query('SELECT id, username, name_ar, name_en, role FROM users WHERE tenant_id = $1', [t])).rows.map((r) => ({
    id: r.id, username: r.username, nameAr: r.name_ar, nameEn: r.name_en, role: r.role,
  }));
  const beneficiaries = (await q.query('SELECT iban, name_ar, name_en FROM beneficiaries WHERE tenant_id = $1', [t])).rows.map((r) => ({
    iban: r.iban, nameAr: r.name_ar, nameEn: r.name_en,
  }));
  const payments = (await q.query('SELECT * FROM payments WHERE tenant_id = $1 ORDER BY created_at', [t])).rows.map(rowToPayment);
  const journalsRaw = (await q.query('SELECT * FROM journal_entries WHERE tenant_id = $1 ORDER BY posted_at', [t])).rows;
  const linesRaw = (await q.query(
    'SELECT l.* FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.tenant_id = $1 ORDER BY l.entry_id, l.line_no',
    [t],
  )).rows;
  const linesByEntry = new Map<string, JournalLine[]>();
  for (const l of linesRaw) {
    const list = linesByEntry.get(l.entry_id) ?? [];
    list.push({ account: l.account, debitMinor: Number(l.debit_minor), creditMinor: Number(l.credit_minor), currency: l.currency });
    linesByEntry.set(l.entry_id, list);
  }
  const journals = journalsRaw.map((j) => ({
    id: j.id,
    tenantId: j.tenant_id,
    paymentId: j.payment_id,
    reason: j.reason,
    postedAt: new Date(j.posted_at).toISOString(),
    postedBy: j.posted_by,
    lines: linesByEntry.get(j.id) ?? [],
  }));
  const hits = (await q.query('SELECT * FROM rule_hits WHERE tenant_id = $1 ORDER BY created_at', [t])).rows.map((h) => ({
    id: h.id,
    tenantId: h.tenant_id,
    paymentId: h.payment_id,
    code: h.code,
    severity: h.severity,
    messageAr: h.message_ar,
    messageEn: h.message_en,
    createdAt: new Date(h.created_at).toISOString(),
  }));
  const audit = (await q.query('SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY seq', [t])).rows.map((a) => ({
    id: a.id,
    tenantId: a.tenant_id,
    seq: Number(a.seq),
    actor: a.actor,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    details: a.details ?? {},
    createdAt: new Date(a.created_at).toISOString(),
    hash: a.hash,
  }));
  const idempotency: Record<string, string> = {};
  for (const row of (await q.query('SELECT key, payment_id FROM idempotency_keys WHERE tenant_id = $1', [t])).rows) {
    idempotency[row.key] = row.payment_id;
  }
  return { tenantId: t, tenantName: tenant.name, users, beneficiaries, payments, journals, hits, audit, idempotency };
}

function rowToPayment(r: pg.QueryResult['rows'][number]): PaymentInstruction {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    status: r.status,
    amountMinor: Number(r.amount_minor),
    feeMinor: Number(r.fee_minor),
    currency: r.currency,
    debtorName: r.debtor_name,
    debtorIban: r.debtor_iban,
    creditorName: r.creditor_name,
    creditorIban: r.creditor_iban,
    creditorNameNormalized: r.creditor_name_normalized,
    reference: r.reference,
    narrative: r.narrative,
    purpose: r.purpose,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    rejectedBy: r.rejected_by,
    approvalStatus: r.approval_status,
    failureReason: r.failure_reason,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public readonly store: Store) {}

  async read<T>(fn: (world: World) => T | Promise<T>): Promise<T> {
    const world = await this.store.load();
    return fn(world);
  }

  async write<T>(fn: (world: World) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = structuredClone(await this.store.load());
      const out = await fn(draft);
      await this.store.save(draft);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
