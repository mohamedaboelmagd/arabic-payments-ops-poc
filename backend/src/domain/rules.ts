import { nameSimilarity } from './arabic.js';
import { DAILY_LIMIT_MINOR, HARD_LIMIT_MINOR, type PaymentInstruction, type RuleHit, type RuleSeverity, type World } from './types.js';

export interface PlannedHit {
  code: string;
  severity: RuleSeverity;
  messageAr: string;
  messageEn: string;
}

/** Fictional watchlist — names are made up for the demo. */
export const WATCHLIST = [
  { nameAr: 'محمود الظل', nameEn: 'Mahmoud Al-Zill' },
  { nameAr: 'شركة الظل للتجارة', nameEn: 'Shadow Trading LLC' },
  { nameAr: 'قمر الصناعية القابضة', nameEn: 'Qamar Industrial Holding' },
];

const SAME_DAY = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

function activeForLimits(p: PaymentInstruction): boolean {
  return !['failed', 'reversed'].includes(p.status);
}

export function evaluateRules(world: World, payment: PaymentInstruction, nowIso: string): PlannedHit[] {
  const hits: PlannedHit[] = [];
  const hard = HARD_LIMIT_MINOR[payment.currency];
  if (payment.amountMinor > hard) {
    hits.push({
      code: 'LIMIT_HARD',
      severity: 'block',
      messageAr: 'المبلغ يتجاوز الحد الأقصى المسموح به للحركة الواحدة.',
      messageEn: 'Amount exceeds the hard per-instruction limit.',
    });
  }

  const dayTotal = world.payments
    .filter((p) => p.debtorIban === payment.debtorIban && p.currency === payment.currency && activeForLimits(p) && SAME_DAY(p.createdAt, nowIso))
    .reduce((s, p) => s + p.amountMinor, 0);
  if (dayTotal > DAILY_LIMIT_MINOR[payment.currency]) {
    hits.push({
      code: 'LIMIT_DAILY',
      severity: 'block',
      messageAr: 'مجموع مدفوعات الآمر اليوم يتجاوز الحد اليومي.',
      messageEn: 'Debtor daily outflow would exceed the configured daily limit.',
    });
  }

  const windowStart = Date.parse(nowIso) - 24 * 3600 * 1000;
  const recent = world.payments.filter(
    (p) => p.createdBy === payment.createdBy && p.id !== payment.id && Date.parse(p.createdAt) >= windowStart && activeForLimits(p),
  );
  if (recent.length >= 5) {
    hits.push({
      code: 'VELOCITY',
      severity: 'warn',
      messageAr: 'أكثر من خمس تعليمات في أربع وعشرين ساعة من نفس المستخدم.',
      messageEn: 'More than five instructions in 24 hours from the same maker.',
    });
  }

  const nearCeiling = Math.round(HARD_LIMIT_MINOR[payment.currency] * 0.099);
  const similar = world.payments.filter(
    (p) =>
      p.debtorIban === payment.debtorIban &&
      p.currency === payment.currency &&
      p.id !== payment.id &&
      activeForLimits(p) &&
      Date.parse(p.createdAt) >= Date.parse(nowIso) - 2 * 3600 * 1000 &&
      Math.abs(p.amountMinor - payment.amountMinor) <= nearCeiling,
  );
  if (payment.amountMinor >= HARD_LIMIT_MINOR[payment.currency] * 0.08 && similar.length >= 2) {
    hits.push({
      code: 'STRUCTURING',
      severity: 'warn',
      messageAr: 'عدة تحويلات متقاربة القيمة في فترة قصيرة — نمط تجزئة محتمل.',
      messageEn: 'Several similarly sized transfers in a short window — possible structuring.',
    });
  }

  for (const entry of WATCHLIST) {
    const score = Math.max(nameSimilarity(payment.creditorName, entry.nameAr), nameSimilarity(payment.creditorName, entry.nameEn));
    if (score >= 0.82) {
      hits.push({
        code: 'WATCHLIST',
        severity: 'block',
        messageAr: `اسم المستفيد قريب من اسم مدرج في قائمة المراقبة التجريبية (${entry.nameAr}).`,
        messageEn: `Beneficiary name is close to a name on the demo watchlist (${entry.nameEn}).`,
      });
      break;
    }
  }

  const known = world.beneficiaries.find((b) => b.iban === payment.creditorIban);
  if (known) {
    const score = Math.max(nameSimilarity(payment.creditorName, known.nameAr), nameSimilarity(payment.creditorName, known.nameEn));
    if (score < 0.55) {
      hits.push({
        code: 'NAME_IBAN_MISMATCH',
        severity: 'warn',
        messageAr: `اسم المستفيد لا يطابق الاسم المسجّل لهذا الحساب (التشابه ${(score * 100).toFixed(0)}٪).`,
        messageEn: `Beneficiary name does not match the name on file for this IBAN (similarity ${(score * 100).toFixed(0)}%).`,
      });
    }
  }

  return hits;
}

export function highestSeverity(hits: Array<Pick<RuleHit, 'severity'> | PlannedHit>): RuleSeverity | null {
  if (hits.some((h) => h.severity === 'block')) return 'block';
  if (hits.some((h) => h.severity === 'warn')) return 'warn';
  if (hits.length) return 'info';
  return null;
}
