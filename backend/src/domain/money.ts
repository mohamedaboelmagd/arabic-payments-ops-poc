import type { Currency } from './types.js';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Parse a decimal string ("12500.50") into integer minor units. No floating point. */
export function parseAmountToMinor(raw: string): number {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new MoneyError(`invalid amount: ${raw}`);
  const neg = s.startsWith('-');
  const [whole, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new MoneyError(`amount out of range: ${raw}`);
  return neg ? -minor : minor;
}

export function formatMinor(minor: number, currency: Currency): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('en-US')}.${frac} ${currency}`;
}

export function formatMinorPlain(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
