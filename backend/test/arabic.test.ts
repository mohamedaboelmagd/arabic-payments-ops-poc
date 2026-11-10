import {
  compactIban,
  editSimilarity,
  isValidIban,
  makeIban,
  nameSimilarity,
  normalizeArabic,
  normalizeRef,
  toLatinDigits,
} from '../src/domain/index.js';

describe('Arabic normalisation', () => {
  it('maps Arabic-Indic and Persian digits to Latin', () => {
    expect(toLatinDigits('INV-٢٠٢٦-٠١١١')).toBe('INV-2026-0111');
    expect(toLatinDigits('مبلغ ۱۲۳٫۴۵')).toBe('مبلغ 123٫45');
  });

  it('strips diacritics and folds alef / teh marbuta / alef maqsura', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabic('شركة')).toBe('شركه');
    expect(normalizeArabic('مستشفى')).toBe('مستشفي');
  });

  it('normalises payment references including Arabic digits', () => {
    expect(normalizeRef('INV-٢٠٢٦/0441')).toBe('INV20260441');
  });

  it('scores Arabic name variants as the same beneficiary', () => {
    const score = nameSimilarity('شركة الأهرام للاستيراد', 'الاهرام للاستيراد');
    expect(score).toBeGreaterThan(0.8);
    expect(nameSimilarity('آفاق للاستيراد', 'افاق للاستيراد')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Horizon Imports', 'آفاق للحديد')).toBeLessThan(0.4);
  });

  it('validates and builds IBANs with a real checksum', () => {
    const eg = makeIban('EG', '0019001122334455667788999');
    expect(eg).toMatch(/^EG\d{2}0019001122334455667788999$/);
    expect(isValidIban(eg)).toBe(true);
    expect(isValidIban(eg.slice(0, -1) + (eg.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(isValidIban('EG00INVALIDIBAN000000000000')).toBe(false);
    expect(compactIban('eg29 0019 0011 2233')).toBe('EG29001900112233');
  });

  it('edit similarity is 1 for identical strings', () => {
    expect(editSimilarity('abc', 'abc')).toBe(1);
    expect(editSimilarity('', '')).toBe(1);
  });
});
