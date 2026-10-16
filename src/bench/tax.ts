export interface Bracket {
  from: number;
  rate: number;
}

export interface YearIncome {
  collected: number;
  interest: number;
  repairs: number;
  otherDeductible: number;
  opex: number;
}

export function progressive(brackets: readonly Bracket[], base: number): number {
  if (base <= 0) return 0;
  let tax = 0;
  for (let k = 0; k < brackets.length; k++) {
    const bracket = brackets[k] as Bracket;
    const upper = brackets[k + 1]?.from ?? Infinity;
    if (base > bracket.from) tax += (Math.min(base, upper) - bracket.from) * bracket.rate;
  }
  return tax;
}

const keep = (amount: number): number => (amount > 1e-12 ? amount : 0);

export interface SpainRules {
  marginal: number;
  reduction: number;
  offsetOtherIncome: boolean;
  amortisationPerYear: number;
  amortisationBasis: number;
  gains: readonly Bracket[];
}

export interface GenericRules {
  rate: number;
  interestDeductible: boolean;
  offsetLosses: boolean;
  depreciationYears: number;
  depreciationPerYear: number;
  capitalGainsRate: number;
  recaptureRate: number;
}

export class SpainTax {
  taken = 0;
  // Unused capped expenses (interest + repairs) from the previous four years;
  // c0 is the latest. What is four years old and still unused expires.
  private c0 = 0;
  private c1 = 0;
  private c2 = 0;
  private c3 = 0;

  constructor(private readonly rules: SpainRules) {}

  reset(): void {
    this.taken = 0;
    this.c0 = this.c1 = this.c2 = this.c3 = 0;
  }

  /** Negative when losses are offset against other income. */
  year(income: YearIncome): number {
    const cap = income.collected;
    let used = 0;
    const u3 = Math.min(this.c3, cap - used);
    used += u3;
    const u2 = Math.min(this.c2, cap - used);
    used += u2;
    const u1 = Math.min(this.c1, cap - used);
    used += u1;
    const u0 = Math.min(this.c0, cap - used);
    used += u0;
    const current = income.interest + income.repairs;
    const uc = Math.min(current, cap - used);
    used += uc;
    this.c3 = keep(this.c2 - u2);
    this.c2 = keep(this.c1 - u1);
    this.c1 = keep(this.c0 - u0);
    this.c0 = keep(current - uc);

    // The 3 % a year stops when the construction basis is used up.
    const { marginal, reduction, offsetOtherIncome, amortisationPerYear, amortisationBasis } =
      this.rules;
    const amortisation = Math.min(amortisationPerYear, Math.max(0, amortisationBasis - this.taken));
    this.taken += amortisation;
    const net = income.collected - used - (income.otherDeductible + amortisation);
    if (net > 0) return marginal * net * (1 - reduction);
    return offsetOtherIncome ? marginal * net : 0;
  }

  exit(gain: number): number {
    return progressive(this.rules.gains, gain);
  }
}

export class GenericTax {
  taken = 0;

  constructor(private readonly rules: GenericRules) {}

  reset(): void {
    this.taken = 0;
  }

  year(income: YearIncome, t: number): number {
    // A fractional last year: 27.5 years of depreciation end with half a year.
    const { rate, interestDeductible, offsetLosses, depreciationYears, depreciationPerYear } =
      this.rules;
    const share = Math.max(0, Math.min(1, depreciationYears - (t - 1)));
    const depreciation = depreciationPerYear ? depreciationPerYear * share : 0;
    this.taken += depreciation;
    const net =
      income.collected - (interestDeductible ? income.interest : 0) - income.opex - depreciation;
    return net > 0 || offsetLosses ? rate * net : 0;
  }

  exit(gain: number): number {
    const { recaptureRate, capitalGainsRate } = this.rules;
    const recapture = Math.min(Math.max(gain, 0), this.taken);
    return recapture * recaptureRate + Math.max(0, gain - this.taken) * capitalGainsRate;
  }
}
