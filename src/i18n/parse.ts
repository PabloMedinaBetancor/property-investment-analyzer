import type { Locale } from './format';

const DECIMAL: Record<Locale, string> = { en: '.', es: ',' };

// A currency sign or code before or after the number, as copied from a portal or a spreadsheet.
const CURRENCY = '(?:[€$£]|eur|usd|gbp)';
const CURRENCY_FIRST = new RegExp(`^([+\\-−]?)${CURRENCY}`, 'i');
const CURRENCY_LAST = new RegExp(`${CURRENCY}$`, 'i');

// Accepts what people type: «1.234,5», «1,234.5», «1234.5», «1 234,5», «5 %», «-0,5», «.5», «€180,000».
// A lone separator is a decimal point when it is the locale's own; the other one is a thousands mark
// only when exactly three digits follow it («1.234» is 1234 in Spanish and 1.234 in English).
export function parseNumber(text: string, locale: Locale): number | null {
  const cleaned = text
    .replace(/\s/g, '')
    .replace(CURRENCY_FIRST, '$1')
    .replace(CURRENCY_LAST, '')
    .replace(/^%|%$/, '')
    .replace('−', '-');
  const match = /^([+-]?)(\d[\d.,]*|[.,]\d+)$/.exec(cleaned);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const body = match[2] ?? '';

  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');
  const decimalAt = decimalPosition(body, lastDot, lastComma, locale);
  if (decimalAt === null) return null;

  // «.5» and «,5»: no digit before the point.
  const integer = decimalAt < 0 ? body : decimalAt === 0 ? '0' : body.slice(0, decimalAt);
  const fraction = decimalAt < 0 ? '' : body.slice(decimalAt + 1);
  if (!validIntegerPart(integer) || /[.,]/.test(fraction)) return null;
  const value = Number(`${integer.replace(/[.,]/g, '')}${fraction ? `.${fraction}` : ''}`);
  return Number.isFinite(value) ? sign * value : null;
}

// Index of the decimal separator in `body`, -1 when there is none, null when the text is malformed.
function decimalPosition(
  body: string,
  lastDot: number,
  lastComma: number,
  locale: Locale,
): number | null {
  if (lastDot >= 0 && lastComma >= 0) return Math.max(lastDot, lastComma);
  const last = Math.max(lastDot, lastComma);
  if (last < 0) return -1;
  const mark = body[last];
  const count = body.split(mark ?? '').length - 1;
  if (count > 1) return -1;
  if (mark === DECIMAL[locale]) return last;
  const threeDigitsFollow = body.length - last - 1 === 3;
  const leading = body.slice(0, last);
  return threeDigitsFollow && /^[1-9]\d{0,2}$/.test(leading) ? -1 : last;
}

// Groups of three after the first, all with the same mark.
function validIntegerPart(integer: string): boolean {
  if (!/[.,]/.test(integer)) return integer.length > 0;
  return /^\d{1,3}([.,]\d{3})+$/.test(integer) && new Set(integer.replace(/\d/g, '')).size === 1;
}
