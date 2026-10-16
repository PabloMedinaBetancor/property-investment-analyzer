export type Locale = 'en' | 'es';

// A plain space could break the line between a number and its %.
const NBSP = String.fromCharCode(0xa0);

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    // Spanish groups from five digits by default (-1990 € beside -24.832 €); a table reads better with every thousand marked.
    found = new Intl.NumberFormat(locale, {
      ...options,
      useGrouping: 'always',
    } as unknown as Intl.NumberFormatOptions);
    formatters.set(key, found);
  }
  return found;
}

// A value that rounds to zero is written as zero: «-0» and «-€0» read as a loss of nothing.
function unsigned(x: number, digits: number): number {
  return Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
}

export function number(x: number, locale: Locale, digits = 2): string {
  return formatter(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    unsigned(x, digits),
  );
}

export function money(x: number, currency: string, locale: Locale, digits = 0): string {
  return formatter(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(unsigned(x, digits));
}

// `x` is a decimal rate (0.0427 is «4.27 %»). Intl would write «4.27%» in English; the space is part of our style.
export function percent(x: number, digits: number, locale: Locale): string {
  return `${number(x * 100, locale, digits)}${NBSP}%`;
}

export function years(x: number, locale: Locale): string {
  return formatter(locale, {
    style: 'unit',
    unit: 'year',
    unitDisplay: 'long',
    maximumFractionDigits: 1,
  }).format(unsigned(x, 1));
}

// `iso` is «2026-10-16». English uses the day-first form («16 Oct 2026») the README uses; UTC keeps the day
// whatever the reader's time zone.
export function date(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}
