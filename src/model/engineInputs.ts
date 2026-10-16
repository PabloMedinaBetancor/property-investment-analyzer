import type { Inputs, Loan } from '../engine/types';
import { LOAN_DEFAULTS } from './defaults';

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const wholeWithin = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;

// With no loan (loan to value 0) the engine ignores the loan fields but its parser still needs a number in
// each of them, and an emptied field is null. The form does not validate these fields then, so a value that
// is empty or that the parser would refuse (a term that is not a whole number of years, fees out of range) is
// replaced here, only on the way to the engine: what the person typed stays as it is.
export function forEngine(inputs: Inputs): Inputs {
  if (inputs.ltv !== 0) return inputs;
  const { loan } = inputs;
  const term_years = wholeWithin(loan.term_years, 1, 40, LOAN_DEFAULTS.term_years);
  const fixed_rate = finite((loan as { fixed_rate?: number }).fixed_rate, LOAN_DEFAULTS.fixed_rate);
  const spread = finite((loan as { spread?: number }).spread, LOAN_DEFAULTS.spread);
  const index = finite((loan as { index?: number }).index, LOAN_DEFAULTS.index);
  let next: Loan;
  if (loan.kind === 'fixed') next = { kind: 'fixed', fixed_rate, term_years };
  else if (loan.kind === 'variable') next = { kind: 'variable', spread, index, term_years };
  else {
    const fixed_years = wholeWithin(
      loan.fixed_years,
      0,
      term_years,
      Math.min(LOAN_DEFAULTS.fixed_years, term_years),
    );
    next = { kind: 'mixed', fixed_rate, fixed_years, spread, index, term_years };
  }
  return { ...inputs, loan: next, loan_fees: 0 };
}
