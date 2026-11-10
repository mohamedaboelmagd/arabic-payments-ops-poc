import { accountBalances, assertBalanced, invertLines, planSubmission } from '../src/domain/index.js';
import type { PaymentInstruction } from '../src/domain/index.js';

const base: PaymentInstruction = {
  id: 'pmt_1',
  tenantId: 't',
  idempotencyKey: 'k',
  kind: 'instant_credit',
  status: 'screened',
  amountMinor: 12500_00,
  feeMinor: 200,
  currency: 'EGP',
  debtorName: 'A',
  debtorIban: 'EG00',
  creditorName: 'B',
  creditorIban: 'EG01',
  creditorNameNormalized: 'B',
  reference: 'R',
  narrative: '',
  purpose: '',
  createdBy: 'usr',
  approvedBy: null,
  rejectedBy: null,
  approvalStatus: 'not_required',
  failureReason: null,
  createdAt: '',
  updatedAt: '',
};

describe('double-entry ledger', () => {
  it('plans a balanced submission including the instant-rail fee', () => {
    const lines = planSubmission(base);
    assertBalanced(lines);
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(12500_00 + 200);
    expect(credit).toBe(debit);
    expect(lines.some((l) => l.account === 'income:scheme_fees' && l.creditMinor === 200)).toBe(true);
    expect(lines.some((l) => l.account === 'asset:instant_scheme' && l.creditMinor === 12500_00)).toBe(true);
  });

  it('uses the clearing network for credit transfers and bill payments', () => {
    const lines = planSubmission({ ...base, kind: 'credit_transfer', feeMinor: 0 });
    expect(lines.some((l) => l.account === 'asset:clearing_network')).toBe(true);
    expect(lines.some((l) => l.account === 'asset:instant_scheme')).toBe(false);
  });

  it('rejects an unbalanced journal', () => {
    expect(() =>
      assertBalanced([{ account: 'a', debitMinor: 10, creditMinor: 0, currency: 'EGP' }]),
    ).toThrow(/unbalanced/);
  });

  it('inverts lines so a reversal nets to zero', () => {
    const lines = planSubmission(base);
    const journals = [
      { id: '1', tenantId: 't', paymentId: 'p', reason: 'submit', postedAt: '', postedBy: 'u', lines },
      { id: '2', tenantId: 't', paymentId: 'p', reason: 'reversal', postedAt: '', postedBy: 'u', lines: invertLines(lines) },
    ];
    const balances = accountBalances(journals);
    for (const acct of Object.keys(balances)) {
      for (const ccy of Object.keys(balances[acct])) {
        expect(balances[acct][ccy as 'EGP']).toBe(0);
      }
    }
  });
});
