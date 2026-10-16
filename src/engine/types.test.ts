import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  Acquisition,
  Analysis,
  ExitRow,
  Histogram,
  Irr,
  IrrPoint,
  McParams,
  McResult,
  Metrics,
  Sensitivity,
  SensitivityBar,
  YearRow,
} from './types';

// Each check returns the path of the first mismatch, or null. `object` takes a record with one check per
// field of T, so a field added to or dropped from the type without updating the check fails tsc.
type Check<T> = { (value: unknown, path: string): string | null; readonly phantom?: T };
type Fields<T> = { [K in keyof T]-?: Check<T[K]> };

const num: Check<number> = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? null : p);
const nullable =
  <T>(c: Check<T>): Check<T | null> =>
  (v, p) =>
    v === null ? null : c(v, p);
const optional =
  <T>(c: Check<T>): Check<T | undefined> =>
  (v, p) =>
    v === undefined ? null : c(v, p);
const array =
  <T>(c: Check<T>): Check<T[]> =>
  (v, p) => {
    if (!Array.isArray(v)) return p;
    for (const [i, item] of v.entries()) {
      const bad = c(item, `${p}[${String(i)}]`);
      if (bad) return bad;
    }
    return null;
  };
const triple =
  <T>(c: Check<T>): Check<[T, T, T]> =>
  (v, p) =>
    Array.isArray(v) && v.length === 3 ? array(c)(v, p) : p;
const literal =
  <T extends string>(...allowed: T[]): Check<T> =>
  (v, p) =>
    typeof v === 'string' && (allowed as string[]).includes(v) ? null : p;
const oneOf =
  <T>(...cs: Check<T>[]): Check<T> =>
  (v, p) =>
    cs.some((c) => c(v, p) === null) ? null : p;
const object =
  <T>(fields: Fields<T>): Check<T> =>
  (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return p;
    const record = v as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(key in fields)) return `${p}.${key} (unexpected)`;
    }
    for (const [key, c] of Object.entries<Check<unknown>>(fields)) {
      const bad = c(record[key], `${p}.${key}`);
      if (bad) return bad;
    }
    return null;
  };

const irr: Check<Irr> = oneOf<Irr>(
  object<{ kind: 'Unique'; rate: number }>({ kind: literal('Unique'), rate: num }),
  object<{ kind: 'Multiple'; rates: number[] }>({ kind: literal('Multiple'), rates: array(num) }),
  object<{ kind: 'None'; reason: 'NoSignChange' | 'OutOfRange' }>({
    kind: literal('None'),
    reason: literal('NoSignChange', 'OutOfRange'),
  }),
);
const irrPoint: Check<IrrPoint> = oneOf<IrrPoint>(num, literal('below', 'above'));

const acquisition = object<Acquisition>({
  transfer_tax: num,
  notary: optional(num),
  registry: optional(num),
  acq_costs: num,
  loan: num,
  total_investment: num,
  equity0: num,
});
const yearRow = object<YearRow>({
  t: num,
  rent_gross: num,
  vacancy: num,
  rent_collected: num,
  opex: num,
  noi: num,
  interest: num,
  principal: num,
  debt_service: num,
  loan_rate: num,
  balance_end: num,
  cf_pre_tax: num,
  tax: num,
  cf_after_tax: num,
  value_end: num,
});
const exitRow = object<ExitRow>({
  value: num,
  sale_costs: num,
  loan_payoff: num,
  gain: num,
  cgt: num,
  equity_back_pre_tax: num,
  equity_back_after_tax: num,
});
const metrics = object<Metrics>({
  gross_yield: num,
  net_yield: num,
  cap_rate: num,
  cash_on_cash_1: nullable(num),
  npv: num,
  irr,
  irr_pre_tax: irr,
  mirr: nullable(num),
  payback_years: nullable(num),
  dscr: nullable(num),
  grm: num,
  one_percent_ratio: num,
  break_even_occupancy: num,
});
// The fixtures hold the reference's analysis, which has no monthly schedule.
const analysisWithoutSchedule = object<Omit<Analysis, 'schedule'>>({
  acquisition,
  years: array(yearRow),
  exit: exitRow,
  flows: array(num),
  flows_pre_tax: array(num),
  cumulative: array(num),
  metrics,
  amortisation_taken: optional(num),
});
const histogram = object<Histogram>({
  edges: array(num),
  counts: array(num),
  below: num,
  above: num,
});
const mcResult = object<McResult>({
  irr_p: nullable(triple(irrPoint)),
  npv_p: triple(num),
  p_npv_negative: num,
  cum_p_by_year: array(triple(num)),
  irr_multiple_count: num,
  irr_bottom_count: num,
  irr_top_count: num,
  npv_histogram: histogram,
});
const mcParams = object<McParams>({
  kappa: num,
  sigma_index: num,
  sigma_rent: num,
  sigma_app: num,
  sigma_exp: num,
  corr: array(array(num)),
});
const bar = object<SensitivityBar>({
  variable: literal('price', 'rent', 'vacancy', 'interest', 'appreciation', 'rent_growth', 'opex'),
  low_value: num,
  high_value: num,
  npv_low: num,
  npv_high: num,
  irr_low: irr,
  irr_high: irr,
});
const sensitivity = object<Sensitivity>({
  base: object<Sensitivity['base']>({ npv: num, irr }),
  bars: array(bar),
});

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve('tests/fixtures', `${name}.json`), 'utf8'));

describe('engine types against the known-answer fixtures', () => {
  it.each(['F1', 'F2', 'F3', 'F4', 'F5'])('proforma_%s result has the Analysis shape', (id) => {
    expect(
      analysisWithoutSchedule((fixture(`proforma_${id}`) as { result: unknown }).result, 'result'),
    ).toBeNull();
  });

  it.each([
    ['monte_carlo_F1_n2000_seed42'],
    ['monte_carlo_F2_n2000_seed42'],
    ['monte_carlo_F3_n500_seed7'],
  ])('%s has the McResult shape and McParams', (name) => {
    const { params, n, seed, ...result } = fixture(name) as Record<string, unknown>;
    expect(mcResult(result, 'result')).toBeNull();
    expect(mcParams(params, 'params')).toBeNull();
    expect(typeof n).toBe('number');
    expect(typeof seed).toBe('number');
  });

  it('sensitivity_F1 has the Sensitivity shape with all seven bars', () => {
    const { base, bars } = fixture('sensitivity_F1') as { base: unknown; bars: unknown[] };
    expect(sensitivity({ base, bars }, 'result')).toBeNull();
    expect(bars).toHaveLength(7);
  });

  it('every irr.json case is one of the three Irr kinds', () => {
    const cases = fixture('irr') as { irr: unknown }[];
    for (const [i, c] of cases.entries()) expect(irr(c.irr, `irr[${String(i)}]`)).toBeNull();
  });

  it('the check rejects a field of the wrong type', () => {
    expect(acquisition({ transfer_tax: '1' }, 'a')).toBe('a.transfer_tax');
  });
});
