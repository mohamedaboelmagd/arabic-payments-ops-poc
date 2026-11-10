import { buildApp } from '../src/app.js';
import { seedWorld } from '../src/domain/seed.js';
import { sha256 } from '../src/services/crypto.js';
import { Repository, memoryStore } from '../src/services/store.js';
import { IBANS } from '../src/domain/seed.js';

async function inject() {
  const repo = new Repository(memoryStore(await seedWorld(sha256)));
  const app = await buildApp({ repo });
  const call = (opts: { method?: 'GET' | 'POST'; url: string; actor?: string; headers?: Record<string, string>; payload?: object }) =>
    app.inject({
      method: opts.method ?? 'GET',
      url: opts.url,
      headers: { 'x-api-key': 'demo_delta_ops_key', 'x-actor': opts.actor ?? 'layla.maker', ...opts.headers },
      payload: opts.payload,
    });
  return { app, call };
}

describe('HTTP API', () => {
  it('rejects a missing API key and unknown actors', async () => {
    const { app } = await inject();
    const noKey = await app.inject({ method: 'GET', url: '/api/v1/summary' });
    expect(noKey.statusCode).toBe(401);
    const badActor = await app.inject({
      method: 'GET',
      url: '/api/v1/summary',
      headers: { 'x-api-key': 'demo_delta_ops_key', 'x-actor': 'ghost' },
    });
    expect(badActor.statusCode).toBe(401);
    await app.close();
  });

  it('exposes the OpenAPI document and seeds a usable queue', async () => {
    const { app, call } = await inject();
    const docs = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(docs.statusCode).toBe(200);
    const spec = docs.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths['/api/v1/payments']).toBeTruthy();
    const summary = await call({ url: '/api/v1/summary' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().totals.payments).toBeGreaterThanOrEqual(10);
    const chain = await call({ url: '/api/v1/audit/verify' });
    expect(chain.json().valid).toBe(true);
    await app.close();
  });

  it('creates a payment idempotently and forbids a viewer from writing', async () => {
    const { app, call } = await inject();
    const body = {
      kind: 'bill_payment',
      amount: '250.00',
      currency: 'EGP',
      debtorName: 'مكتب الخزانة — دلتا',
      debtorIban: IBANS.debtor,
      creditorName: 'مرافق وادي النيل',
      creditorIban: IBANS.utilities,
      reference: 'BILL-TEST-1',
    };
    const first = await call({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { 'idempotency-key': 'http-idem-1', 'content-type': 'application/json' },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().replayed).toBe(false);
    const replay = await call({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { 'idempotency-key': 'http-idem-1', 'content-type': 'application/json' },
      payload: body,
    });
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().payment.id).toBe(first.json().payment.id);

    const viewer = await call({
      method: 'POST',
      url: '/api/v1/payments',
      actor: 'sara.viewer',
      headers: { 'content-type': 'application/json' },
      payload: { ...body, reference: 'BILL-TEST-2' },
    });
    expect(viewer.statusCode).toBe(403);
    await app.close();
  });
});
