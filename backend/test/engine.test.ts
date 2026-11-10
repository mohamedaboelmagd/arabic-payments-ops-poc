import {
  IBANS,
  approvePayment,
  createPayment,
  failPayment,
  rejectPayment,
  reversePayment,
  runChecks,
  settlePayment,
  submitPayment,
  verifyAudit,
} from '../src/domain/index.js';
import { freshWorld, makeCtx, sha256 } from './helpers.js';

const valid = {
  kind: 'instant_credit' as const,
  amount: '12000.00',
  currency: 'EGP' as const,
  debtorName: 'مكتب الخزانة — دلتا',
  debtorIban: IBANS.debtor,
  creditorName: 'آفاق للاستيراد',
  creditorIban: IBANS.horizon,
  reference: 'INV-2026-1001',
  narrative: 'test',
};

describe('payments kernel', () => {
  it('creates a payment and replays the same idempotency key', async () => {
    const world = freshWorld();
    const first = await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-1' });
    expect(first.replayed).toBe(false);
    expect(first.payment.status).toBe('initiated');
    const second = await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-1' });
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
  });

  it('rejects a reused idempotency key with a different payload', async () => {
    const world = freshWorld();
    await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-2' });
    await expect(createPayment(makeCtx(world), { ...valid, amount: '1.00', idempotencyKey: 'k-2' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('walks the happy path and posts a balanced journal', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-3' });
    await runChecks(makeCtx(world), payment.id);
    expect(world.payments[0].status).toBe('screened');
    expect(world.payments[0].approvalStatus).toBe('not_required');
    await submitPayment(makeCtx(world), payment.id);
    expect(world.payments[0].status).toBe('submitted');
    expect(world.journals).toHaveLength(1);
    const debit = world.journals[0].lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = world.journals[0].lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit);
    await settlePayment(makeCtx(world, 'ahmed.admin'), payment.id);
    expect(world.payments[0].status).toBe('settled');
  });

  it('requires a different checker above the approval threshold (four-eyes)', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), { ...valid, amount: '75000.00', kind: 'credit_transfer', idempotencyKey: 'k-4' });
    await runChecks(makeCtx(world), payment.id);
    expect(world.payments[0].approvalStatus).toBe('pending');
    await expect(approvePayment(makeCtx(world, 'layla.maker'), payment.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(submitPayment(makeCtx(world), payment.id)).rejects.toMatchObject({ statusCode: 409 });
    await approvePayment(makeCtx(world, 'omar.checker'), payment.id, 'ok');
    expect(world.payments[0].approvalStatus).toBe('approved');
    await submitPayment(makeCtx(world), payment.id);
    expect(world.payments[0].status).toBe('submitted');
  });

  it('fails validation on a bad IBAN', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), {
      ...valid,
      creditorIban: 'EG00INVALIDIBAN000000000000',
      idempotencyKey: 'k-5',
    });
    await runChecks(makeCtx(world), payment.id);
    expect(world.payments[0].status).toBe('failed');
    expect(world.payments[0].failureReason).toMatch(/IBAN/);
  });

  it('blocks submission when screening hits the demo watchlist', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), {
      ...valid,
      kind: 'credit_transfer',
      creditorName: 'Shadow Trading LLC',
      creditorIban: IBANS.other,
      idempotencyKey: 'k-6',
    });
    const { hits } = await runChecks(makeCtx(world), payment.id);
    expect(hits.some((h) => h.code === 'WATCHLIST' && h.severity === 'block')).toBe(true);
    await expect(submitPayment(makeCtx(world), payment.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('warns when the beneficiary name does not match the IBAN directory', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), {
      ...valid,
      creditorName: 'مكتب النور للاستشارات',
      idempotencyKey: 'k-7',
    });
    const { hits } = await runChecks(makeCtx(world), payment.id);
    expect(hits.some((h) => h.code === 'NAME_IBAN_MISMATCH')).toBe(true);
    expect(world.payments[0].approvalStatus).toBe('pending');
  });

  it('reverses the journal when a submitted payment fails, and after settlement', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-8' });
    await runChecks(makeCtx(world), payment.id);
    await submitPayment(makeCtx(world), payment.id);
    await failPayment(makeCtx(world, 'ahmed.admin'), payment.id, 'scheme rejected');
    expect(world.payments[0].status).toBe('failed');
    expect(world.journals).toHaveLength(2);
    expect(world.journals[1].reason).toBe('fail_reversal');

    const world2 = freshWorld();
    const created = await createPayment(makeCtx(world2), { ...valid, idempotencyKey: 'k-9' });
    await runChecks(makeCtx(world2), created.payment.id);
    await submitPayment(makeCtx(world2), created.payment.id);
    await settlePayment(makeCtx(world2, 'ahmed.admin'), created.payment.id);
    await reversePayment(makeCtx(world2, 'ahmed.admin'), created.payment.id, 'customer dispute');
    expect(world2.payments[0].status).toBe('reversed');
    expect(world2.journals.at(-1)?.reason).toBe('reversal');
  });

  it('lets a checker reject, and forbids viewers from creating payments', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), { ...valid, amount: '60000.00', kind: 'credit_transfer', idempotencyKey: 'k-10' });
    await runChecks(makeCtx(world), payment.id);
    await rejectPayment(makeCtx(world, 'omar.checker'), payment.id, 'missing invoice');
    expect(world.payments[0].status).toBe('failed');
    expect(world.payments[0].approvalStatus).toBe('rejected');
    await expect(createPayment(makeCtx(world, 'sara.viewer'), { ...valid, idempotencyKey: 'k-11' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('keeps a verifiable hash chain on the audit log', async () => {
    const world = freshWorld();
    const { payment } = await createPayment(makeCtx(world), { ...valid, idempotencyKey: 'k-12' });
    await runChecks(makeCtx(world), payment.id);
    const result = await verifyAudit(world, sha256);
    expect(result.valid).toBe(true);
    expect(result.entries).toBeGreaterThan(1);
    world.audit[0].hash = 'deadbeef';
    const broken = await verifyAudit(world, sha256);
    expect(broken.valid).toBe(false);
  });
});
