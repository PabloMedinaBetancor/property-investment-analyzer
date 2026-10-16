import type { Inputs, McParams } from '../engine/types';
import { regions } from './profiles';

export type ErrorKey =
  | 'error.required'
  | 'error.notNumber'
  | 'error.notInteger'
  | 'error.outOfRange'
  | 'error.unknownRegion'
  | 'error.badCorrelation'
  | 'error.tooManyScenarios'
  | 'error.tooManyYears';

export interface Limit {
  min: number;
  max: number;
  minOpen?: boolean;
  integer?: boolean;
}

const MAX_SCENARIOS = 100_000;

const closed = (min: number, max: number): Limit => ({ min, max });
const above0 = (max: number): Limit => ({ min: 0, max, minOpen: true });
const whole = (min: number, max: number): Limit => ({ min, max, integer: true });

const amount = closed(0, 1e8);
const share = closed(0, 1);
const taxRate = closed(0, 0.7);
const rate = closed(0, 0.5);
const growth = closed(-0.5, 0.5);

// The engine's table of limits, by JSON path. `loan.fixed_years` is further capped by the term.
export const limits: Readonly<Record<string, Limit>> = {
  price: above0(1e9),
  renovation: amount,
  loan_fees: amount,
  ibi: amount,
  community: amount,
  insurance: amount,
  other_fixed: amount,
  municipal_gain_tax: amount,
  notary_extras: amount,
  gestoria: amount,
  'purchase.closing_cost_fixed': amount,
  reference_value: closed(0, 1e9),
  value0: above0(1e10),
  ltv: share,
  'loan.term_years': whole(1, 40),
  'loan.fixed_rate': closed(0, 0.3),
  'loan.spread': closed(-0.05, 0.1),
  'loan.index': closed(-0.05, 0.2),
  'loan.fixed_years': whole(0, 40),
  rent_month: above0(1e7),
  vacancy: closed(0, 0.99),
  maintenance_rate: closed(0, 0.9),
  management_rate: closed(0, 0.9),
  property_tax_rate: closed(0, 0.05),
  g_rent: growth,
  g_exp: growth,
  g_app: growth,
  sell_rate: closed(0, 0.5),
  discount_rate: closed(-0.5, 1),
  years: whole(1, 40),
  manual_transfer_rate: rate,
  buyer_agency_rate: rate,
  'purchase.transfer_tax_rate': rate,
  'purchase.closing_cost_rate': rate,
  'purchase.buyer_agency_rate': rate,
  'tax.marginal': taxRate,
  'tax.rate': taxRate,
  'tax.capital_gains_rate': taxRate,
  'tax.depreciation_recapture_rate': taxRate,
  'tax.reduction': share,
  'tax.construction_share': share,
  'tax.building_share': share,
  'tax.depreciation_years': closed(0, 100),
  n: whole(1, MAX_SCENARIOS),
  'params.kappa': share,
  'params.sigma_index': closed(0, 0.5),
  'params.sigma_rent': closed(0, 0.5),
  'params.sigma_app': closed(0, 0.5),
  'params.sigma_exp': closed(0, 0.5),
};

const INDEX_PATH_LIMIT = closed(-0.05, 0.2);
const MAX_INDEX_PATH = 40;

type Errors = Record<string, ErrorKey>;

function at(root: object, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function limitError(value: unknown, limit: Limit): ErrorKey | null {
  if (value === undefined || value === null) return 'error.required';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'error.notNumber';
  if (limit.integer === true && !Number.isInteger(value)) return 'error.notInteger';
  const below = limit.minOpen === true ? value <= limit.min : value < limit.min;
  return below || value > limit.max ? 'error.outOfRange' : null;
}

function check(root: object, path: string, errors: Errors, limit: Limit = limits[path] as Limit) {
  const error = limitError(at(root, path), limit);
  if (error !== null) errors[path] = error;
}

// reference_value and the manual rate are optional: null means «not given».
function checkOptional(root: object, path: string, errors: Errors) {
  if (isGiven(root, path)) check(root, path, errors);
}

function isGiven(root: object, path: string): boolean {
  const value = at(root, path);
  return value !== null && value !== undefined;
}

function checkFlag(root: object, path: string, errors: Errors) {
  if (typeof at(root, path) !== 'boolean') errors[path] = 'error.required';
}

// The fixed period cannot outlast the loan; without a loan, or with a term not yet typed, the term cap applies.
export function fixedYearsLimit(inputs: Inputs): Limit {
  const borrowing = typeof inputs.ltv === 'number' && inputs.ltv > 0;
  return whole(
    0,
    borrowing && Number.isFinite(inputs.loan.term_years) ? inputs.loan.term_years : 40,
  );
}

function checkLoan(inputs: Inputs, errors: Errors) {
  const { loan } = inputs;
  // With no loan the engine ignores every loan field, so none of them can block the analysis.
  if (inputs.ltv === 0) return;
  const borrowing = typeof inputs.ltv === 'number' && inputs.ltv > 0;
  if (borrowing) check(inputs, 'loan.term_years', errors);
  if (loan.kind !== 'variable') check(inputs, 'loan.fixed_rate', errors);
  if (loan.kind !== 'fixed') {
    check(inputs, 'loan.spread', errors);
    check(inputs, 'loan.index', errors);
    const path = loan.index_path ?? [];
    if (path.length > MAX_INDEX_PATH) errors['loan.index_path'] = 'error.tooManyYears';
    path.forEach((value, i) => {
      const error = limitError(value, INDEX_PATH_LIMIT);
      if (error !== null) errors[`loan.index_path[${i.toString()}]`] = error;
    });
  }
  if (loan.kind === 'mixed') {
    check(inputs, 'loan.fixed_years', errors, fixedYearsLimit(inputs));
  }
}

function checkSpain(inputs: Inputs, errors: Errors) {
  for (const path of ['notary_extras', 'gestoria', 'buyer_agency_rate'])
    check(inputs, path, errors);
  checkOptional(inputs, 'reference_value', errors);
  checkOptional(inputs, 'manual_transfer_rate', errors);
  checkFlag(inputs, 'new_build', errors);
  const region = regions().find((r) => r.code === inputs.region);
  if (typeof inputs.region !== 'string' || inputs.region === '')
    errors['region'] = 'error.required';
  else if (!region) errors['region'] = 'error.unknownRegion';
  else if (
    inputs.new_build === true &&
    region.newBuildVat === null &&
    !isGiven(inputs, 'manual_transfer_rate')
  ) {
    errors['manual_transfer_rate'] = 'error.required';
  }
  if (inputs.tax.on) {
    for (const key of ['marginal', 'reduction', 'construction_share'])
      check(inputs, `tax.${key}`, errors);
    checkFlag(inputs, 'tax.offset_other_income', errors);
  }
}

function checkGeneric(inputs: Inputs, errors: Errors) {
  check(inputs, 'property_tax_rate', errors);
  for (const key of ['transfer_tax_rate', 'closing_cost_rate', 'buyer_agency_rate']) {
    check(inputs, `purchase.${key}`, errors);
  }
  check(inputs, 'purchase.closing_cost_fixed', errors);
  if (inputs.tax.on) {
    for (const key of [
      'rate',
      'capital_gains_rate',
      'depreciation_recapture_rate',
      'building_share',
    ]) {
      check(inputs, `tax.${key}`, errors);
    }
    const years = inputs.tax.depreciation_years;
    if (years !== 0) check(inputs, 'tax.depreciation_years', errors, closed(1, 100));
    for (const key of ['interest_deductible', 'offset_losses'])
      checkFlag(inputs, `tax.${key}`, errors);
  }
}

// Messages while typing: one error per JSON path, in the engine's wording of limits.
export function fieldErrors(inputs: Inputs): Errors {
  const errors: Errors = {};
  for (const path of ['price', 'rent_month', 'ltv', 'vacancy', 'years'])
    check(inputs, path, errors);
  for (const path of ['renovation', 'ibi', 'community', 'insurance', 'other_fixed']) {
    check(inputs, path, errors);
  }
  if (inputs.ltv !== 0) check(inputs, 'loan_fees', errors);
  for (const path of ['maintenance_rate', 'management_rate', 'g_rent', 'g_exp', 'g_app']) {
    check(inputs, path, errors);
  }
  for (const path of ['sell_rate', 'municipal_gain_tax', 'discount_rate'])
    check(inputs, path, errors);
  checkOptional(inputs, 'value0', errors);
  checkLoan(inputs, errors);
  if (inputs.profile === 'generic') checkGeneric(inputs, errors);
  else checkSpain(inputs, errors);
  return errors;
}

export const isValid = (inputs: Inputs) => Object.keys(fieldErrors(inputs)).length === 0;

// Symmetric, unit diagonal, entries within [-1, 1] and positive definite: the Cholesky pivots the engine needs.
function correlationError(corr: number[][]): boolean {
  const size = 4;
  const l: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row = corr[i];
    if (row?.length !== size) return true;
    l.push(new Array<number>(size).fill(0));
    for (let j = 0; j < size; j++) {
      const a = row[j] ?? Number.NaN;
      const mirror = corr[j]?.[i] ?? Number.NaN;
      if (!Number.isFinite(a) || Math.abs(a) > 1 || Math.abs(a - mirror) > 1e-12) return true;
      if (i === j && Math.abs(a - 1) > 1e-12) return true;
    }
  }
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = corr[i]?.[j] ?? 0;
      for (let k = 0; k < j; k++) sum -= (l[i]?.[k] ?? 0) * (l[j]?.[k] ?? 0);
      if (i === j) {
        if (sum <= 1e-12) return true;
        (l[i] as number[])[j] = Math.sqrt(sum);
      } else {
        (l[i] as number[])[j] = sum / (l[j]?.[j] ?? 1);
      }
    }
  }
  return false;
}

export function mcFieldErrors(n: number, params: McParams): Errors {
  const errors: Errors = {};
  if (Number.isFinite(n) && n > MAX_SCENARIOS) errors['n'] = 'error.tooManyScenarios';
  else check({ n }, 'n', errors);
  const root = { params };
  for (const key of ['kappa', 'sigma_index', 'sigma_rent', 'sigma_app', 'sigma_exp']) {
    check(root, `params.${key}`, errors);
  }
  if (correlationError(params.corr)) errors['params.corr'] = 'error.badCorrelation';
  return errors;
}
