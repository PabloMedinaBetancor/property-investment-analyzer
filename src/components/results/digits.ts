import type { MessageKey } from '../../i18n';

// Break-even and GRM read well with one decimal; every other metric keeps two.
const ONE_DECIMAL: MessageKey[] = ['term.grm', 'term.breakEvenOccupancy'];

export function digitsOf(term: MessageKey): number {
  return ONE_DECIMAL.includes(term) ? 1 : 2;
}
