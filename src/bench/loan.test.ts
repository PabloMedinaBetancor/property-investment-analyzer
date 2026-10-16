import { describe, expect, it } from 'vitest';
import { close, fixture } from './fixtures';
import { Loan, payment } from './loan';

interface FixedCase {
  loan: number;
  annual_rate: number;
  years: number;
  payment: number;
  balance_after: Record<string, number>;
  year_1: { interest: number; principal: number };
}

interface IndexedCase {
  loan: number;
  kind: 'variable' | 'mixed';
  years: number;
  spread: number;
  fixed_rate?: number;
  fixed_years?: number;
  index?: number;
  index_by_year?: number[];
  balance_end_of_year: number[];
}

const cases = fixture('amortisation') as (FixedCase | IndexedCase)[];
const fixedCases = cases.filter((c): c is FixedCase => 'annual_rate' in c);
const indexedCases = cases.filter((c): c is IndexedCase => 'kind' in c);

describe('payment', () => {
  it('is 599.55 a month on 100 000 at 6 % over 30 years', () => {
    expect(payment(100000, 0.06 / 12, 360)).toBeCloseTo(599.55, 2);
  });

  it('divides the balance evenly at 0 %: 120 000 over 120 months is 1 000', () => {
    expect(payment(120000, 0, 120)).toBe(1000);
  });
});

describe('Loan.step on fixed loans', () => {
  it.each(fixedCases)('$loan at $annual_rate over $years years matches the fixture', (c) => {
    const loan = new Loan(
      { kind: 'fixed', fixed_rate: c.annual_rate, term_years: c.years },
      c.loan,
    );
    loan.step(1, 0);
    expect(close(loan.interest, c.year_1.interest)).toBe(true);
    expect(close(loan.principal, c.year_1.principal)).toBe(true);
    for (let year = 2; year <= c.years; year++) {
      loan.step(year, 0);
      const months = String(12 * year);
      if (months in c.balance_after)
        expect(close(loan.balance, c.balance_after[months] as number)).toBe(true);
    }
    expect(Math.abs(loan.balance)).toBeLessThan(1e-6);
  });
});

describe('Loan.step on variable and mixed loans', () => {
  it.each(indexedCases)(
    '$kind loan of $loan over $years years follows the fixture balances',
    (c) => {
      const terms =
        c.kind === 'variable'
          ? { kind: 'variable' as const, spread: c.spread, index: 0, term_years: c.years }
          : {
              kind: 'mixed' as const,
              fixed_rate: c.fixed_rate as number,
              fixed_years: c.fixed_years as number,
              spread: c.spread,
              index: 0,
              term_years: c.years,
            };
      const loan = new Loan(terms, c.loan);
      c.balance_end_of_year.forEach((expected, i) => {
        loan.step(i + 1, c.index_by_year?.[i] ?? (c.index as number));
        expect(close(loan.balance, expected)).toBe(true);
      });
    },
  );

  it('floors the rate at 0 when index plus spread is negative', () => {
    const loan = new Loan({ kind: 'variable', spread: 0.009, index: 0, term_years: 5 }, 150000);
    loan.step(1, -0.012);
    expect(loan.interest).toBe(0);
    expect(loan.principal).toBeCloseTo(30000, 6);
  });
});

describe('Loan after its term', () => {
  it('keeps the balance and pays nothing', () => {
    const loan = new Loan({ kind: 'fixed', fixed_rate: 0.05, term_years: 1 }, 12000);
    loan.step(1, 0);
    const balance = loan.balance;
    loan.step(2, 0);
    expect([loan.interest, loan.principal, loan.balance]).toEqual([0, 0, balance]);
  });
});
