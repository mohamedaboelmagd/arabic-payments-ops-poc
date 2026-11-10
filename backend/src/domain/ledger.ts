import { LEDGER_ACCOUNTS, type Currency, type JournalEntry, type JournalLine, type PaymentInstruction, type PaymentKind } from './types.js';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function railAccount(kind: PaymentKind): string {
  return kind === 'instant_credit' ? LEDGER_ACCOUNTS.instantScheme : LEDGER_ACCOUNTS.clearingNetwork;
}

export function assertBalanced(lines: JournalLine[]): void {
  const byCcy = new Map<Currency, { d: number; c: number }>();
  for (const line of lines) {
    if (line.debitMinor < 0 || line.creditMinor < 0) throw new LedgerError('negative debit/credit');
    if (line.debitMinor > 0 && line.creditMinor > 0) throw new LedgerError('line cannot be both debit and credit');
    if (line.debitMinor === 0 && line.creditMinor === 0) throw new LedgerError('empty line');
    const rec = byCcy.get(line.currency) ?? { d: 0, c: 0 };
    rec.d += line.debitMinor;
    rec.c += line.creditMinor;
    byCcy.set(line.currency, rec);
  }
  for (const [ccy, rec] of byCcy) {
    if (rec.d !== rec.c) throw new LedgerError(`unbalanced ${ccy} journal: debit ${rec.d} != credit ${rec.c}`);
  }
}

export function invertLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debitMinor: l.creditMinor, creditMinor: l.debitMinor }));
}

/** Outgoing customer payment: reduce customer deposits, reduce the rail nostro, recognise any fee. */
export function planSubmission(p: PaymentInstruction): JournalLine[] {
  const rail = railAccount(p.kind);
  const principal = p.amountMinor;
  const fee = p.feeMinor;
  const lines: JournalLine[] = [
    { account: LEDGER_ACCOUNTS.customerDeposits, debitMinor: principal + fee, creditMinor: 0, currency: p.currency },
    { account: rail, debitMinor: 0, creditMinor: principal, currency: p.currency },
  ];
  if (fee > 0) {
    lines.push({ account: LEDGER_ACCOUNTS.feeIncome, debitMinor: 0, creditMinor: fee, currency: p.currency });
  }
  assertBalanced(lines);
  return lines;
}

export function accountBalances(journals: JournalEntry[]): Record<string, Record<Currency, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const j of journals) {
    for (const line of j.lines) {
      out[line.account] ??= {};
      // signed balance: debit − credit. Assets/expenses positive when debited;
      // liabilities/income positive when credited — callers display both sides.
      out[line.account][line.currency] = (out[line.account][line.currency] ?? 0) + line.debitMinor - line.creditMinor;
    }
  }
  return out as Record<string, Record<Currency, number>>;
}
