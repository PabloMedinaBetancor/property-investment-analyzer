import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fieldErrors, mcFieldErrors } from '../model/validate';
import { loadEngine, parseEnvelope, type Engine, type Envelope, type Op } from './abi';
import type { Analysis, Inputs, McParams, McRequest, McResult, Sensitivity } from './types';

interface ProformaFixture {
  inputs: Inputs;
  result: Analysis;
}

interface McFixture {
  params: McParams;
  n: number;
  seed: number;
}

type Base = 'F1' | 'F2' | 'F3';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve('tests/fixtures', `${name}.json`), 'utf8'));

const proforma = {
  F1: fixture('proforma_F1') as ProformaFixture,
  F2: fixture('proforma_F2') as ProformaFixture,
  F3: fixture('proforma_F3') as ProformaFixture,
};
const mc = fixture('monte_carlo_F2_n2000_seed42') as McFixture;
const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

let engine: Engine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(resolve('src/engine/invest_engine.wasm')));
});

function send(op: Op, request: unknown): Envelope {
  return parseEnvelope(engine.run(op, JSON.stringify(request)));
}

// Every number compared with the same 1e-9 bar as the engine's own tests; keys absent from the expected are not checked.
function expectClose(actual: unknown, expected: unknown, path = 'result'): void {
  if (typeof expected === 'number') {
    const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
    const close = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
    expect(close, `${path}: ${String(actual)} is not ${String(expected)}`).toBe(true);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual) && actual.length === expected.length, `${path} length`).toBe(true);
    expected.forEach((item, i) => {
      expectClose((actual as unknown[])[i], item, `${path}[${String(i)}]`);
    });
  } else if (typeof expected === 'object' && expected !== null) {
    for (const [key, item] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[key], item, `${path}.${key}`);
    }
  } else {
    expect(actual, path).toEqual(expected);
  }
}

function withoutKeys(record: object, keys: string[]): object {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

describe('the engine through the real wasm', () => {
  it.each(['F1', 'F2', 'F3', 'F4', 'F5'] as const)(
    'analyze of %s gives the reference result at 1e-9',
    (name) => {
      const expected = fixture(`proforma_${name}`) as ProformaFixture;
      const outcome = send('analyze', expected.inputs);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expectClose(outcome.value, expected.result);
    },
  );

  it.each([
    ['F1', 'proforma_F1', 'monte_carlo_F1_n2000_seed42'],
    ['F2', 'proforma_F2', 'monte_carlo_F2_n2000_seed42'],
    ['F3', 'proforma_F3', 'monte_carlo_F3_n500_seed7'],
  ])(
    'simulate of %s gives the reference percentiles at 1e-9 (%s, %s)',
    (_name, inputsFile, mcFile) => {
      const inputs = (fixture(inputsFile) as ProformaFixture).inputs;
      const expected = fixture(mcFile) as McFixture & McResult;
      const request = { inputs, params: expected.params, n: expected.n, seed: expected.seed };
      const outcome = send('simulate', request);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expectClose(outcome.value, withoutKeys(expected, ['params', 'n', 'seed']));
    },
  );

  it('simulate of F2 returns the committed golden bytes', () => {
    const request = { inputs: proforma.F2.inputs, params: mc.params, n: 2000, seed: 42 };
    const golden = readFileSync(
      resolve('engine/tests/golden', 'simulate_F2_n2000_seed42.json'),
      'utf8',
    );
    expect(engine.run('simulate', JSON.stringify(request))).toBe(golden);
  });

  it('sensitivity of F1 gives the seven reference bars at 1e-9', () => {
    const expected = fixture('sensitivity_F1') as Sensitivity & { inputs: Inputs };
    const outcome = send('sensitivity', { inputs: expected.inputs });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expectClose(outcome.value, withoutKeys(expected, ['inputs']));
  });
});

describe('error envelopes', () => {
  it('broken JSON is invalid_json', () => {
    expect(parseEnvelope(engine.run('analyze', '{"price": '))).toMatchObject({
      ok: false,
      error: { code: 'invalid_json' },
    });
  });

  it('a missing price is missing_field at price', () => {
    expect(send('analyze', withField(proforma.F1.inputs, 'price', undefined))).toMatchObject({
      ok: false,
      error: { code: 'missing_field', field: 'price' },
    });
  });

  it('a null price is not_finite at price', () => {
    expect(send('analyze', { ...proforma.F1.inputs, price: null })).toMatchObject({
      ok: false,
      error: { code: 'not_finite', field: 'price' },
    });
  });

  it('an unknown field is invalid_json', () => {
    expect(send('analyze', { ...proforma.F1.inputs, pricee: 1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_json' },
    });
  });
});

// Each row is one limit of the engine's table (path, base, good and bad values). A bad value must fail with the engine's
// code at that field and validate.ts must flag it; a good value must not fail at that field and must not be flagged.
interface LimitCase {
  path: string;
  op?: 'analyze' | 'simulate';
  base?: Base;
  code?: string;
  good: unknown[];
  bad: unknown[];
}

const amount = { good: [0, 100_000_000], bad: [-1, 100_000_001] };
const rate05 = { good: [0, 0.5], bad: [-0.001, 0.501] };
const tax07 = { good: [0, 0.7], bad: [-0.001, 0.701] };
const growth = { good: [-0.5, 0.5], bad: [-0.501, 0.501] };

const limitCases: LimitCase[] = [
  { path: 'price', good: [1_000_000_000, 0.001], bad: [0, 1_000_000_001] },
  { path: 'renovation', ...amount },
  { path: 'loan_fees', ...amount },
  { path: 'ibi', ...amount },
  { path: 'community', ...amount },
  { path: 'insurance', ...amount },
  { path: 'other_fixed', ...amount },
  { path: 'municipal_gain_tax', ...amount },
  { path: 'notary_extras', ...amount },
  { path: 'gestoria', ...amount },
  { path: 'purchase.closing_cost_fixed', base: 'F3', ...amount },
  { path: 'reference_value', good: [null, 0, 1_000_000_000], bad: [-1, 1_000_000_001] },
  { path: 'value0', good: [null, 0.001, 10_000_000_000], bad: [0, 10_000_000_001] },
  { path: 'ltv', good: [0, 1], bad: [-0.001, 1.001] },
  { path: 'loan.term_years', good: [1, 40], bad: [0, 41] },
  { path: 'loan.fixed_rate', good: [0, 0.3], bad: [-0.001, 0.301] },
  { path: 'loan.spread', base: 'F2', good: [-0.05, 0.1], bad: [-0.051, 0.101] },
  { path: 'loan.index', base: 'F2', good: [-0.05, 0.2], bad: [-0.051, 0.201] },
  { path: 'loan.index_path[1]', base: 'F2', good: [-0.05, 0.2], bad: [-0.051, 0.201] },
  {
    path: 'loan.index_path',
    base: 'F2',
    good: [Array<number>(40).fill(0.01)],
    bad: [Array<number>(41).fill(0.01)],
  },
  { path: 'loan.fixed_years', base: 'F2', good: [0, 30], bad: [31] },
  { path: 'rent_month', good: [0.001, 10_000_000], bad: [0, 10_000_001] },
  { path: 'vacancy', good: [0, 0.99], bad: [-0.001, 0.991] },
  { path: 'maintenance_rate', good: [0, 0.9], bad: [-0.001, 0.901] },
  { path: 'management_rate', good: [0, 0.9], bad: [-0.001, 0.901] },
  { path: 'property_tax_rate', base: 'F3', good: [0, 0.05], bad: [-0.001, 0.051] },
  { path: 'g_rent', ...growth },
  { path: 'g_exp', ...growth },
  { path: 'g_app', ...growth },
  { path: 'sell_rate', good: [0, 0.5], bad: [-0.001, 0.501] },
  { path: 'discount_rate', good: [-0.5, 1], bad: [-0.501, 1.001] },
  { path: 'years', good: [1, 40], bad: [0, 41] },
  { path: 'manual_transfer_rate', ...rate05 },
  { path: 'buyer_agency_rate', ...rate05 },
  { path: 'purchase.transfer_tax_rate', base: 'F3', ...rate05 },
  { path: 'purchase.closing_cost_rate', base: 'F3', ...rate05 },
  { path: 'purchase.buyer_agency_rate', base: 'F3', ...rate05 },
  { path: 'tax.marginal', ...tax07 },
  { path: 'tax.reduction', good: [0, 1], bad: [-0.001, 1.001] },
  { path: 'tax.construction_share', good: [0, 1], bad: [-0.001, 1.001] },
  { path: 'tax.rate', base: 'F3', ...tax07 },
  { path: 'tax.capital_gains_rate', base: 'F3', ...tax07 },
  { path: 'tax.depreciation_recapture_rate', base: 'F3', ...tax07 },
  { path: 'tax.building_share', base: 'F3', good: [0, 1], bad: [-0.001, 1.001] },
  { path: 'tax.depreciation_years', base: 'F3', good: [0, 1, 100], bad: [0.5, 101] },
  { path: 'n', op: 'simulate', good: [1, 100_000], bad: [0] },
  { path: 'n', op: 'simulate', code: 'too_many_scenarios', good: [], bad: [100_001] },
  { path: 'params.kappa', op: 'simulate', good: [0, 1], bad: [-0.001, 1.001] },
  { path: 'params.sigma_index', op: 'simulate', ...rate05 },
  { path: 'params.sigma_rent', op: 'simulate', ...rate05 },
  { path: 'params.sigma_app', op: 'simulate', ...rate05 },
  { path: 'params.sigma_exp', op: 'simulate', ...rate05 },
  {
    path: 'params.corr',
    op: 'simulate',
    code: 'bad_correlation',
    good: [identity, mc.params.corr],
    bad: [
      [
        [1, 0.3, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [0.9, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1, 1.2, 0, 0],
        [1.2, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1, -0.5, -0.5, -0.5],
        [-0.5, 1, -0.5, -0.5],
        [-0.5, -0.5, 1, -0.5],
        [-0.5, -0.5, -0.5, 1],
      ],
    ],
  },
];

function withField(root: unknown, path: string, value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  const parent = keys
    .slice(0, -1)
    .reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, copy);
  parent[keys.at(-1) ?? ''] = value;
  return copy;
}

function requestFor(op: 'analyze' | 'simulate', base: Base): unknown {
  if (op === 'analyze') return proforma[base].inputs;
  return { inputs: proforma.F2.inputs, params: mc.params, n: mc.n, seed: mc.seed };
}

function flaggedBy(
  op: 'analyze' | 'simulate',
  request: unknown,
): Record<string, string | undefined> {
  if (op === 'analyze') return fieldErrors(request as Inputs);
  const { n, params } = request as McRequest;
  return mcFieldErrors(n, params);
}

describe('input limits, engine and validate.ts side by side', () => {
  it.each(limitCases)(
    '$path',
    ({ path, op = 'analyze', base = 'F1', code = 'out_of_range', good, bad }) => {
      const root = requestFor(op, base);
      for (const value of bad) {
        const request = withField(root, path, value);
        const label = `${path} = ${JSON.stringify(value)}`;
        expect(send(op, request), label).toMatchObject({ ok: false, error: { code, field: path } });
        expect(flaggedBy(op, request)[path], label).toBeDefined();
      }
      for (const value of good) {
        const request = withField(root, path, value);
        const label = `${path} = ${JSON.stringify(value)}`;
        const outcome = send(op, request);
        if (!outcome.ok) expect(outcome.error.field, label).not.toBe(path);
        expect(flaggedBy(op, request)[path], label).toBeUndefined();
      }
    },
  );
});
