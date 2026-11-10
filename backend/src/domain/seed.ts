import { makeIban } from './arabic.js';
import {
  approvePayment,
  createPayment,
  rejectPayment,
  reversePayment,
  runChecks,
  settlePayment,
  submitPayment,
  type KernelCtx,
} from './engine.js';
import type { CreatePaymentInput, User, World } from './types.js';

export const DEMO_TENANT = { id: 'ten_delta_ops', name: 'Delta Treasury Desk' };
export const DEMO_API_KEY = 'demo_delta_ops_key';

export const DEMO_USERS: User[] = [
  { id: 'usr_layla', username: 'layla.maker', nameAr: 'ليلى حسن', nameEn: 'Layla Hassan', role: 'maker' },
  { id: 'usr_omar', username: 'omar.checker', nameAr: 'عمر فؤاد', nameEn: 'Omar Fouad', role: 'checker' },
  { id: 'usr_nora', username: 'nora.auditor', nameAr: 'نورة عبد الله', nameEn: 'Nora Abdallah', role: 'auditor' },
  { id: 'usr_ahmed', username: 'ahmed.admin', nameAr: 'أحمد منصور', nameEn: 'Ahmed Mansour', role: 'admin' },
  { id: 'usr_sara', username: 'sara.viewer', nameAr: 'سارة نبيل', nameEn: 'Sara Nabil', role: 'viewer' },
];

export const IBANS = {
  debtor: makeIban('EG', '0019001122334455667788999'),
  horizon: makeIban('EG', '0021001987654321098765432'),
  utilities: makeIban('EG', '0033001555666777888999000'),
  sahara: makeIban('EG', '0044001222111333444555666'),
  other: makeIban('SA', '3300001234567890123456'),
};

export function emptyWorld(): World {
  return {
    tenantId: DEMO_TENANT.id,
    tenantName: DEMO_TENANT.name,
    users: DEMO_USERS.map((u) => ({ ...u })),
    beneficiaries: [
      { iban: IBANS.horizon, nameAr: 'آفاق للاستيراد', nameEn: 'Horizon Imports' },
      { iban: IBANS.utilities, nameAr: 'مرافق وادي النيل', nameEn: 'Nile Valley Utilities' },
      { iban: IBANS.sahara, nameAr: 'صحراء للتجزئة', nameEn: 'Sahara Retail SAE' },
    ],
    payments: [],
    journals: [],
    hits: [],
    audit: [],
    idempotency: {},
  };
}

export async function seedWorld(hash: (s: string) => Promise<string>): Promise<World> {
  const world = emptyWorld();
  let seq = 0;
  let t = Date.parse('2026-11-08T08:00:00.000Z');
  const id = (prefix: string) => `${prefix}_${String(++seq).padStart(4, '0')}`;
  const now = () => new Date(t).toISOString();
  const tick = (ms = 90_000) => {
    t += ms;
  };

  const ctxFor = (username: string): KernelCtx => {
    const actor = world.users.find((u) => u.username === username)!;
    return { world, actor, now, id, hash };
  };

  const create = async (username: string, input: CreatePaymentInput) => {
    tick();
    return (await createPayment(ctxFor(username), input)).payment;
  };

  // 1. Instant credit — fully settled (below approval threshold, clean screening).
  const settled = await create('layla.maker', {
    idempotencyKey: 'seed-settled-instant-001',
    kind: 'instant_credit',
    amount: '12500.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'آفاق للاستيراد',
    creditorIban: IBANS.horizon,
    reference: 'INV-٢٠٢٦-0441',
    narrative: 'تسوية فاتورة توريد نوفمبر',
    purpose: 'trade',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), settled.id);
  tick();
  await submitPayment(ctxFor('layla.maker'), settled.id);
  tick();
  await settlePayment(ctxFor('ahmed.admin'), settled.id);

  // 2. Credit transfer — waiting on checker (above threshold).
  const pending = await create('layla.maker', {
    idempotencyKey: 'seed-pending-transfer-002',
    kind: 'credit_transfer',
    amount: '75000.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'Sahara Retail SAE',
    creditorIban: IBANS.sahara,
    reference: 'PO-8891',
    narrative: 'دفعة إيجار المستودع الربع الرابع',
    purpose: 'rent',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), pending.id);

  // 3. Bill payment — submitted to the clearing network, awaiting settlement.
  const submitted = await create('layla.maker', {
    idempotencyKey: 'seed-submitted-bill-003',
    kind: 'bill_payment',
    amount: '3450.75',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'مرافق وادي النيل',
    creditorIban: IBANS.utilities,
    reference: 'BILL-ELEC-2026-11',
    narrative: 'فاتورة كهرباء نوفمبر',
    purpose: 'utilities',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), submitted.id);
  tick();
  await submitPayment(ctxFor('layla.maker'), submitted.id);

  // 4. Initiated — drafts waiting for the maker to run checks.
  await create('layla.maker', {
    idempotencyKey: 'seed-draft-instant-004',
    kind: 'instant_credit',
    amount: '8200.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'Horizon Imports',
    creditorIban: IBANS.horizon,
    reference: 'INV-2026-0512',
    narrative: 'دفعة أولى',
    purpose: 'trade',
  });

  // 5. Failed validation — checksum-invalid creditor IBAN.
  const bad = await create('layla.maker', {
    idempotencyKey: 'seed-bad-iban-005',
    kind: 'credit_transfer',
    amount: '1500.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'مستفيد تجريبي',
    creditorIban: 'EG00INVALIDIBAN000000000000',
    reference: 'TEST-BAD-IBAN',
    narrative: 'يجب أن تفشل التحقق',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), bad.id);

  // 6. Settled then reversed.
  const reversed = await create('layla.maker', {
    idempotencyKey: 'seed-reversed-006',
    kind: 'instant_credit',
    amount: '22000.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'آفاق للاستيراد',
    creditorIban: IBANS.horizon,
    reference: 'INV-2026-0390',
    narrative: 'أُعيدت بعد اعتراض العميل',
    purpose: 'trade',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), reversed.id);
  tick();
  await submitPayment(ctxFor('layla.maker'), reversed.id);
  tick();
  await settlePayment(ctxFor('ahmed.admin'), reversed.id);
  tick();
  await reversePayment(ctxFor('ahmed.admin'), reversed.id, 'customer dispute — funds returned');

  // 7. Watchlist hit (demo list) — blocked from submission.
  const watch = await create('layla.maker', {
    idempotencyKey: 'seed-watchlist-007',
    kind: 'credit_transfer',
    amount: '9100.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'Shadow Trading LLC',
    creditorIban: IBANS.other,
    reference: 'WIRE-4402',
    narrative: 'يجب أن تُوقفها قائمة المراقبة التجريبية',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), watch.id);

  // 8. Name / IBAN mismatch warning + pending approval.
  const mismatch = await create('layla.maker', {
    idempotencyKey: 'seed-mismatch-008',
    kind: 'credit_transfer',
    amount: '18000.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'مكتب النور للاستشارات',
    creditorIban: IBANS.horizon,
    reference: 'ADV-118',
    narrative: 'اسم المستفيد لا يطابق الاسم المسجّل للحساب',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), mismatch.id);

  // 9. Checker rejected a high-value transfer.
  const rejected = await create('layla.maker', {
    idempotencyKey: 'seed-rejected-009',
    kind: 'credit_transfer',
    amount: '64000.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'Sahara Retail SAE',
    creditorIban: IBANS.sahara,
    reference: 'PO-9004',
    narrative: 'طلب ملغى — بيانات العقد غير مكتملة',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), rejected.id);
  tick();
  await rejectPayment(ctxFor('omar.checker'), rejected.id, 'supporting contract missing');

  // 10. High-value transfer already approved, ready to submit.
  const approved = await create('layla.maker', {
    idempotencyKey: 'seed-approved-010',
    kind: 'instant_credit',
    amount: '88000.00',
    currency: 'EGP',
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'Horizon Imports',
    creditorIban: IBANS.horizon,
    reference: 'INV-2026-0601',
    narrative: 'دفعة توريد معدّات',
    purpose: 'trade',
  });
  tick();
  await runChecks(ctxFor('layla.maker'), approved.id);
  tick();
  await approvePayment(ctxFor('omar.checker'), approved.id, 'contract and invoice checked');

  return world;
}
