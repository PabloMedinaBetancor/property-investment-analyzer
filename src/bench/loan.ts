import type { Inputs } from '../engine/types';

export type LoanTerms = Inputs['loan'];

export function payment(balance: number, monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return balance / months;
  return (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/** A French loan advanced one year at a time; each step leaves its results in the public fields. */
export class Loan {
  interest = 0;
  principal = 0;
  balance: number;
  private instalment = 0;

  constructor(
    private readonly terms: LoanTerms,
    private readonly amount: number,
  ) {
    this.balance = amount;
  }

  reset(): void {
    this.balance = this.amount;
    this.instalment = 0;
  }

  // The floor at 0 is Ley 5/2019 art. 21.3. A variable or mixed loan re-computes
  // its instalment each anniversary from the balance, even inside the fixed part
  // of a mixed loan, as the reference does.
  step(year: number, index: number): void {
    const terms = this.terms;
    if (year > terms.term_years) {
      this.interest = 0;
      this.principal = 0;
      return;
    }
    const monthlyRate =
      (terms.kind === 'fixed' || (terms.kind === 'mixed' && year <= terms.fixed_years)
        ? terms.fixed_rate
        : Math.max(0, index + terms.spread)) / 12;
    if (year === 1 || terms.kind !== 'fixed') {
      this.instalment = payment(this.balance, monthlyRate, 12 * (terms.term_years - year + 1));
    }
    let interest = 0;
    let principal = 0;
    let balance = this.balance;
    for (let month = 0; month < 12; month++) {
      const monthInterest = balance * monthlyRate;
      const monthPrincipal = this.instalment - monthInterest;
      balance -= monthPrincipal;
      interest += monthInterest;
      principal += monthPrincipal;
    }
    this.interest = interest;
    this.principal = principal;
    this.balance = balance;
  }
}
