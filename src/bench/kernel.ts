import spain from '../../data/es-2026.json';
import type { Acquisition, Inputs, IrrPoint, McParams, McResult } from '../engine/types';
import { Loan } from './loan';
import { MAX_ROOTS, npv, percentile7, scenarioIrr } from './metrics';
import { Rng } from './rng';
import { GenericTax, SpainTax, type YearIncome } from './tax';

// The TypeScript mirror of the engine's simulate, for the benchmark only. The
// acquisition comes from `analyze`, so both implementations time just the scenarios.
export interface KernelRequest {
  inputs: Inputs;
  acquisition: Acquisition;
  params: McParams;
  n: number;
  seed: number;
}

export type KernelResult = Omit<McResult, 'npv_histogram'>;

const MAX_YEARS = 40;
const PERCENTILES = [0.1, 0.5, 0.9] as const;

interface Plan {
  years: number;
  equity0: number;
  basis: number;
  index0: number;
  inputs: Inputs;
  propertyTaxRate: number;
  value0: number;
  loan: Loan | null;
  tax: SpainTax | GenericTax | null;
}

interface Factor {
  l00: number;
  l10: number;
  l11: number;
  l20: number;
  l21: number;
  l22: number;
  l30: number;
  l31: number;
  l32: number;
  l33: number;
}

function need<T>(value: T | undefined, field: string): T {
  if (value === undefined)
    throw new TypeError(`${field} is missing; the engine validates inputs before the kernel runs`);
  return value;
}

function pivot(d: number): number {
  if (!(d > 0)) throw new RangeError('the correlation matrix is not positive definite');
  return Math.sqrt(d);
}

function cholesky(corr: number[][]): Factor {
  const r = (i: number, j: number): number => corr[i]?.[j] ?? Number.NaN;
  const l00 = pivot(r(0, 0));
  const l10 = r(1, 0) / l00;
  const l11 = pivot(r(1, 1) - l10 * l10);
  const l20 = r(2, 0) / l00;
  const l21 = (r(2, 1) - l20 * l10) / l11;
  const l22 = pivot(r(2, 2) - (l20 * l20 + l21 * l21));
  const l30 = r(3, 0) / l00;
  const l31 = (r(3, 1) - l30 * l10) / l11;
  const l32 = (r(3, 2) - (l30 * l20 + l31 * l21)) / l22;
  const l33 = pivot(r(3, 3) - (l30 * l30 + l31 * l31 + l32 * l32));
  return { l00, l10, l11, l20, l21, l22, l30, l31, l32, l33 };
}

function taxRules(inputs: Inputs, basis: number): SpainTax | GenericTax | null {
  const { tax } = inputs;
  if (!tax.on) return null;
  if (inputs.profile === 'generic') {
    const years = need(tax.depreciation_years, 'tax.depreciation_years');
    return new GenericTax({
      rate: need(tax.rate, 'tax.rate'),
      interestDeductible: need(tax.interest_deductible, 'tax.interest_deductible'),
      offsetLosses: need(tax.offset_losses, 'tax.offset_losses'),
      depreciationYears: years,
      depreciationPerYear: years
        ? (need(tax.building_share, 'tax.building_share') * basis) / years
        : 0,
      capitalGainsRate: need(tax.capital_gains_rate, 'tax.capital_gains_rate'),
      recaptureRate: need(tax.depreciation_recapture_rate, 'tax.depreciation_recapture_rate'),
    });
  }
  const construction = need(tax.construction_share, 'tax.construction_share') * basis;
  return new SpainTax({
    marginal: need(tax.marginal, 'tax.marginal'),
    reduction: need(tax.reduction, 'tax.reduction'),
    offsetOtherIncome: need(tax.offset_other_income, 'tax.offset_other_income'),
    amortisationPerYear: 0.03 * construction,
    amortisationBasis: construction,
    gains: spain.income_tax.capital_gains_scale.brackets,
  });
}

function prepare(inputs: Inputs, acquisition: Acquisition): Plan {
  const basis = inputs.price + acquisition.acq_costs + inputs.renovation;
  return {
    years: inputs.years,
    equity0: acquisition.equity0,
    basis,
    index0: 'index' in inputs.loan ? inputs.loan.index : 0,
    inputs,
    propertyTaxRate: inputs.property_tax_rate ?? 0,
    value0: inputs.value0 ?? inputs.price,
    loan: acquisition.loan > 0 ? new Loan(inputs.loan, acquisition.loan) : null,
    tax: taxRules(inputs, basis),
  };
}

function irrPoint(value: number): IrrPoint {
  if (value === -Infinity) return 'below';
  return value === Infinity ? 'above' : value;
}

function percentiles(sorted: Float64Array): [number, number, number] {
  return [
    percentile7(sorted, PERCENTILES[0]),
    percentile7(sorted, PERCENTILES[1]),
    percentile7(sorted, PERCENTILES[2]),
  ];
}

export class Simulator {
  private cumulative = new Float64Array(0);
  private npvs = new Float64Array(0);
  private irrs = new Float64Array(0);
  private readonly flowBuffer = new Float64Array(MAX_YEARS + 1);
  private readonly roots = new Float64Array(MAX_ROOTS);
  private readonly income: YearIncome = {
    collected: 0,
    interest: 0,
    repairs: 0,
    otherDeductible: 0,
    opex: 0,
  };

  run({ inputs, acquisition, params, n, seed }: KernelRequest): KernelResult {
    const plan = prepare(inputs, acquisition);
    const factor = cholesky(params.corr);
    const { years } = plan;
    if (this.cumulative.length < (years + 1) * n)
      this.cumulative = new Float64Array((years + 1) * n);
    if (this.npvs.length < n) {
      this.npvs = new Float64Array(n);
      this.irrs = new Float64Array(n);
    }
    const flows = this.flowBuffer.subarray(0, years + 1);
    const rng = new Rng(seed);
    let included = 0;
    let multiple = 0;
    let bottom = 0;
    let top = 0;
    let negative = 0;
    for (let s = 0; s < n; s++) {
      this.scenario(plan, params, factor, rng, flows);
      let total = 0;
      for (let t = 0; t <= years; t++) {
        total += flows[t] as number;
        this.cumulative[t * n + s] = total;
      }
      const value = npv(plan.inputs.discount_rate, flows);
      this.npvs[s] = value;
      if (value < 0) negative++;
      const rate = scenarioIrr(flows, this.roots);
      if (Number.isNaN(rate)) {
        multiple++;
        continue;
      }
      this.irrs[included++] = rate;
      if (rate === -Infinity) bottom++;
      else if (rate === Infinity) top++;
    }

    const irrSorted = this.irrs.subarray(0, included).sort();
    const npvSorted = this.npvs.subarray(0, n).sort();
    const cum_p_by_year: [number, number, number][] = [];
    for (let t = 0; t <= years; t++) {
      cum_p_by_year.push(percentiles(this.cumulative.subarray(t * n, (t + 1) * n).sort()));
    }
    const irrP = percentiles(irrSorted);
    return {
      irr_p: included === 0 ? null : [irrPoint(irrP[0]), irrPoint(irrP[1]), irrPoint(irrP[2])],
      npv_p: percentiles(npvSorted),
      p_npv_negative: negative / n,
      cum_p_by_year,
      irr_multiple_count: multiple,
      irr_bottom_count: bottom,
      irr_top_count: top,
    };
  }

  // One scenario, drawn year by year in the order of the reference (§7 of docs/how-it-works.md):
  // four normals, then twelve uniforms for the months of vacancy. Year-1 shocks of
  // rent, expenses and index are drawn and unused so the stream stays aligned.
  private scenario(plan: Plan, params: McParams, f: Factor, rng: Rng, flows: Float64Array): void {
    const x = plan.inputs;
    const { loan, tax } = plan;
    const income = this.income;
    loan?.reset();
    tax?.reset();
    let index = plan.index0;
    let rent = 12 * x.rent_month;
    let fixed = x.ibi + x.community + x.insurance + x.other_fixed;
    let value = plan.value0;
    let balance = 0;
    let lastFlow = 0;
    flows[0] = -plan.equity0;
    for (let t = 1; t <= plan.years; t++) {
      const eps0 = rng.normalPair();
      const eps1 = rng.second;
      const eps2 = rng.normalPair();
      const eps3 = rng.second;
      const z0 = f.l00 * eps0;
      const z1 = f.l10 * eps0 + f.l11 * eps1;
      const z2 = f.l20 * eps0 + f.l21 * eps1 + f.l22 * eps2;
      const z3 = f.l30 * eps0 + f.l31 * eps1 + f.l32 * eps2 + f.l33 * eps3;
      if (t >= 2) index = index + params.kappa * (plan.index0 - index) + params.sigma_index * z0;
      const growthRent = Math.max(-0.99, x.g_rent + params.sigma_rent * z1);
      const growthValue = Math.max(-0.99, x.g_app + params.sigma_app * z2);
      const growthExpenses = Math.max(-0.99, x.g_exp + params.sigma_exp * z3);
      let emptyMonths = 0;
      for (let month = 0; month < 12; month++) if (rng.uniform() < x.vacancy) emptyMonths++;
      const vacancy = emptyMonths / 12;

      if (t > 1) {
        rent *= 1 + growthRent;
        fixed *= 1 + growthExpenses;
      }
      const propertyTax = plan.propertyTaxRate * value;
      value *= 1 + growthValue;
      const collected = rent * (1 - vacancy);
      const maintenance = x.maintenance_rate * rent;
      const management = x.management_rate * collected;
      const opex = fixed + propertyTax + maintenance + management;
      let interest = 0;
      let debtService = 0;
      if (loan) {
        loan.step(t, index);
        interest = loan.interest;
        debtService = interest + loan.principal;
        balance = loan.balance;
      }
      lastFlow = collected - opex - debtService;
      if (tax) {
        income.collected = collected;
        income.interest = interest;
        income.repairs = maintenance;
        income.otherDeductible = fixed + propertyTax + management;
        income.opex = opex;
        lastFlow -= tax.year(income, t);
      }
      flows[t] = lastFlow;
    }
    const saleCosts = value * x.sell_rate + x.municipal_gain_tax;
    const taken = tax?.taken ?? 0;
    const cgt = tax ? tax.exit(value - saleCosts - (plan.basis - taken)) : 0;
    flows[plan.years] = lastFlow + (value - saleCosts - balance - cgt);
  }
}
