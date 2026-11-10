/** Arabic + Latin text helpers. Pure functions — no I/O. */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(s: string): string {
  return (s ?? '').replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : PERSIAN.indexOf(d));
  });
}

/** Strip tashkeel, tatweel, and fold alef / teh marbuta / alef maqsura variants. */
export function normalizeArabic(s: string): string {
  return toLatinDigits(s ?? '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

const STOPWORDS = new Set([
  'co', 'company', 'comp', 'llc', 'ltd', 'limited', 'sae', 'se', 'inc', 'corp', 'group', 'the', 'and', 'for', 'of',
  'شركه', 'مؤسسه', 'موسسه', 'ش', 'م', 'ذ', 'و', 'لل',
]);

export function nameTokens(s: string): string[] {
  const cleaned = normalizeArabic(s)
    .toLowerCase()
    .replace(/s\.a\.e\.?/g, 'sae')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return cleaned
    .split(/\s+/)
    .map((t) => (t.length > 4 && (t.startsWith('ال') || t.startsWith('لل')) ? t.slice(2) : t))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      inter += 1;
      counts.set(x, n - 1);
    }
  }
  return (2 * inter) / (a.length + b.length);
}

/** Score two beneficiary / customer names (0..1) after Arabic normalisation. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length && !tb.length) return 1;
  const joinedA = ta.join(' ');
  const joinedB = tb.join(' ');
  const token = dice(ta, tb);
  const gram = dice(bigrams(joinedA), bigrams(joinedB));
  const edit = editSimilarity(joinedA, joinedB);
  return token * 0.45 + gram * 0.35 + edit * 0.2;
}

export function normalizeRef(s: string): string {
  return toLatinDigits(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Compact IBAN: Latin digits, uppercase, no spaces. Does not validate the checksum. */
export function compactIban(s: string): string {
  return toLatinDigits(s ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') expanded += String(ch.charCodeAt(0) - 55);
    else expanded += ch;
  }
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

export function isValidIban(s: string): boolean {
  const iban = compactIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.length < 15 || iban.length > 34) return false;
  return ibanMod97(iban) === 1;
}

/** Build a checksum-valid IBAN from a country code and BBAN (for fixtures). */
export function makeIban(country: string, bban: string): string {
  const cc = country.toUpperCase();
  const body = (bban.replace(/[\s-]/g, '')).toUpperCase();
  const rem = ibanMod97(`${cc}00${body}`);
  const check = String(98 - rem).padStart(2, '0');
  return `${cc}${check}${body}`;
}

export function displayIban(s: string): string {
  return compactIban(s).replace(/(.{4})/g, '$1 ').trim();
}
