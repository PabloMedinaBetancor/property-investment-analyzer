import { describe, expect, it } from 'vitest';
import { close, fixture } from './fixtures';
import { GenericTax, SpainTax, progressive, type Bracket } from './tax';

interface SpainCase {
  name: string;
  income: number[];
  interest: number[];
  repairs: number[];
  other_deductible: number[];
  amortisation_per_year: number;
  amortisation_basis: number;
  marginal: number;
  reduction: number;
  offset_other_income: boolean;
  tax: number[];
  amortisation_taken: number;
}

interface GenericCase {
  name: string;
  collected: number[];
  interest: number[];
  opex: number[];
  depreciation_per_year: number;
  depreciation_years: number;
  rate: number;
  interest_deductible: boolean;
  offset_losses: boolean;
  tax: number[];
  depreciation_taken: number;
}

interface ExitCase {
  gain: number;
  depreciation_taken: number;
  recapture_rate: number;
  capital_gains_rate: number;
  exit_tax: number;
}

const taxes = fixture('income_tax') as {
  spain: SpainCase[];
  generic: GenericCase[];
  generic_exit: ExitCase[];
};
const gains: Bracket[] = [
  { from: 0, rate: 0.19 },
  { from: 6000, rate: 0.21 },
  { from: 50000, rate: 0.23 },
  { from: 200000, rate: 0.27 },
  { from: 300000, rate: 0.3 },
];

describe('SpainTax.year', () => {
  it.each(taxes.spain)('$name', (c) => {
    const tax = new SpainTax({
      marginal: c.marginal,
      reduction: c.reduction,
      offsetOtherIncome: c.offset_other_income,
      amortisationPerYear: c.amortisation_per_year,
      amortisationBasis: c.amortisation_basis,
      gains,
    });
    c.income.forEach((collected, k) => {
      const paid = tax.year({
        collected,
        interest: c.interest[k] as number,
        repairs: c.repairs[k] as number,
        otherDeductible: c.other_deductible[k] as number,
        opex: 0,
      });
      expect(close(paid, c.tax[k] as number)).toBe(true);
    });
    expect(close(tax.taken, c.amortisation_taken)).toBe(true);
  });
});

describe('GenericTax', () => {
  it.each(taxes.generic)('$name', (c) => {
    const tax = new GenericTax({
      rate: c.rate,
      interestDeductible: c.interest_deductible,
      offsetLosses: c.offset_losses,
      depreciationYears: c.depreciation_years,
      depreciationPerYear: c.depreciation_per_year,
      capitalGainsRate: 0.15,
      recaptureRate: 0.25,
    });
    c.collected.forEach((collected, k) => {
      const paid = tax.year(
        {
          collected,
          interest: c.interest[k] as number,
          repairs: 0,
          otherDeductible: 0,
          opex: c.opex[k] as number,
        },
        k + 1,
      );
      expect(close(paid, c.tax[k] as number)).toBe(true);
    });
    expect(close(tax.taken, c.depreciation_taken)).toBe(true);
  });

  it.each(taxes.generic_exit)(
    'taxes a gain of $gain over $depreciation_taken of depreciation at $exit_tax',
    (c) => {
      const tax = new GenericTax({
        rate: 0.24,
        interestDeductible: true,
        offsetLosses: true,
        depreciationYears: 10,
        depreciationPerYear: c.depreciation_taken / 10,
        capitalGainsRate: c.capital_gains_rate,
        recaptureRate: c.recapture_rate,
      });
      for (let t = 1; t <= 10; t++)
        tax.year({ collected: 1, interest: 0, repairs: 0, otherDeductible: 0, opex: 0 }, t);
      expect(close(tax.exit(c.gain), c.exit_tax)).toBe(true);
    },
  );
});

describe('progressive', () => {
  it('taxes a capital gain of 400 000 at 71 880 plus 30 % of the last 100 000', () => {
    expect(close(progressive(gains, 400000), 71880 + 100000 * 0.3)).toBe(true);
  });

  it('is zero for a loss', () => {
    expect(progressive(gains, -5)).toBe(0);
  });
});
