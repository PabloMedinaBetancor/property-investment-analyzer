import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Inputs } from '../engine/types';
import { defaultInputs, defaultMc, defaultTax } from './defaults';
import { examples, namedInputs } from './examples';
import { genericProfile, profiles, ratesAsOf, regions } from './profiles';
import { fromPercent, toPercent } from './units';
import { fieldErrors, mcFieldErrors } from './validate';

const fixtureInputs = (name: string): Inputs =>
  (
    JSON.parse(readFileSync(resolve('tests/fixtures', `${name}.json`), 'utf8')) as {
      inputs: Inputs;
    }
  ).inputs;

const example = (id: string): Inputs => {
  const found = examples.find((e) => e.id === id);
  if (!found) throw new Error(`no example ${id}`);
  return found.inputs;
};

describe('profiles', () => {
  it('lists Spain, the generic market and the US example', () => {
    expect(profiles.map((p) => p.id)).toEqual(['es', 'generic', 'us-example']);
    expect(profiles.map((p) => p.currency)).toEqual(['EUR', 'EUR', 'USD']);
  });

  it('lists the 19 regions with Ceuta and Melilla having no new-build VAT', () => {
    const all = regions();
    expect(all).toHaveLength(19);
    expect(all.filter((r) => r.newBuildVat === null).map((r) => r.code)).toEqual(['CE', 'ML']);
    expect(all.find((r) => r.code === 'MD')?.newBuildVat).toBe(0.1);
    expect(all.find((r) => r.code === 'CN')?.newBuildVat).toBe(0.07);
  });

  it('carries the rates date of the shipped data', () => {
    expect(ratesAsOf).toBe('2026-10-16');
  });

  it('reads the US example: 27.5 years of depreciation, 6 % selling costs', () => {
    const us = genericProfile('us-example');
    expect(us.income_tax.depreciation_years).toBe(27.5);
    expect(us.exit.selling_cost_rate).toBe(0.06);
  });
});

describe('defaults', () => {
  it.each([
    ['es', defaultInputs('es')],
    ['es in Ceuta', defaultInputs('es', 'CE')],
    ['generic', defaultInputs('generic')],
    ['us-example', defaultInputs('us-example')],
  ])('the %s defaults validate clean', (_, inputs) => {
    expect(fieldErrors(inputs)).toEqual({});
  });

  it.each(['es', 'generic', 'us-example'] as const)(
    'the %s tax block validates clean when switched on',
    (id) => {
      const inputs = { ...defaultInputs(id), tax: defaultTax(id) };
      expect(fieldErrors(inputs)).toEqual({});
    },
  );

  it('Spain defaults take the notary extras 300 and gestoría 350 from the data', () => {
    const inputs = defaultInputs('es');
    expect([inputs.notary_extras, inputs.gestoria, inputs.region]).toEqual([300, 350, 'MD']);
  });

  it('US defaults: USD, property tax 1.1 %, no HOA', () => {
    const inputs = defaultInputs('us-example');
    expect([inputs.currency, inputs.property_tax_rate, inputs.community]).toEqual([
      'USD',
      0.011,
      0,
    ]);
  });

  it('the Monte Carlo defaults validate clean', () => {
    expect(mcFieldErrors(defaultMc.n, defaultMc.params)).toEqual({});
  });

  it('returns a fresh object each time', () => {
    expect(defaultInputs('es')).not.toBe(defaultInputs('es'));
    expect(defaultInputs('es').loan).not.toBe(defaultInputs('es').loan);
  });
});

describe('examples', () => {
  it.each([
    ['madrid', 'proforma_F1'],
    ['valencia', 'proforma_F2'],
    ['us', 'proforma_F3'],
  ])('example %s deep-equals the inputs of %s', (id, fixture) => {
    expect(example(id)).toEqual(fixtureInputs(fixture));
  });

  it('has the four examples with both labels', () => {
    expect(examples.map((e) => e.label.en)).toEqual([
      'Resale flat, Madrid',
      'New-build flat, Valencia',
      'Single-family rental, US-style',
      'Resale flat, Las Palmas (Canary Islands)',
    ]);
    expect(examples.every((e) => e.label.es !== '')).toBe(true);
  });

  it('every example validates clean', () => {
    for (const e of examples) expect(fieldErrors(e.inputs)).toEqual({});
  });
});

describe('units', () => {
  it('converts 0.07 to 7 without binary noise', () => {
    expect(toPercent(0.07)).toBe(7);
    expect(toPercent(0.032)).toBe(3.2);
  });

  it('converts 3.2 back to 0.032 and 7 to 0.07', () => {
    expect(fromPercent(3.2)).toBe(0.032);
    expect(fromPercent(7)).toBe(0.07);
  });

  it('keeps a negative rate: -0.5 % is -0.005', () => {
    expect(fromPercent(-0.5)).toBe(-0.005);
  });
});

describe('validate', () => {
  const es = () => defaultInputs('es');

  it('flags ltv 1.2 under ltv', () => {
    expect(fieldErrors({ ...es(), ltv: 1.2 })).toEqual({ ltv: 'error.outOfRange' });
  });

  it('flags vacancy 1 under vacancy (the limit is 0.99)', () => {
    expect(fieldErrors({ ...es(), vacancy: 1 })).toEqual({ vacancy: 'error.outOfRange' });
  });

  it('flags years 0 and years 41, accepts 1 and 40', () => {
    expect(fieldErrors({ ...es(), years: 0 })).toEqual({ years: 'error.outOfRange' });
    expect(fieldErrors({ ...es(), years: 41 })).toEqual({ years: 'error.outOfRange' });
    expect(fieldErrors({ ...es(), years: 1 })).toEqual({});
    expect(fieldErrors({ ...es(), years: 40 })).toEqual({});
  });

  it('flags a fractional number of years', () => {
    expect(fieldErrors({ ...es(), years: 2.5 })).toEqual({ years: 'error.notInteger' });
  });

  it('flags a price of 0 (the lower limit is open) and accepts 1e9', () => {
    expect(fieldErrors({ ...es(), price: 0 })).toEqual({ price: 'error.outOfRange' });
    expect(fieldErrors({ ...es(), price: 1e9 })).toEqual({});
  });

  it('flags NaN as not a number and a missing price as required', () => {
    expect(fieldErrors({ ...es(), price: Number.NaN })).toEqual({ price: 'error.notNumber' });
    const rest: Partial<Inputs> = es();
    delete rest.price;
    expect(fieldErrors(rest as Inputs)).toEqual({ price: 'error.required' });
  });

  it('flags an unknown region and a missing one', () => {
    expect(fieldErrors({ ...es(), region: 'XX' })).toEqual({ region: 'error.unknownRegion' });
    expect(fieldErrors({ ...es(), region: '' })).toEqual({ region: 'error.required' });
  });

  it('asks for the manual transfer rate on a new build in Ceuta', () => {
    const inputs = { ...defaultInputs('es', 'CE'), new_build: true };
    expect(fieldErrors(inputs)).toEqual({ manual_transfer_rate: 'error.required' });
    expect(fieldErrors({ ...inputs, manual_transfer_rate: 0.04 })).toEqual({});
  });

  it('checks the loan term only when there is a loan', () => {
    const noLoan = {
      ...es(),
      ltv: 0,
      loan: { kind: 'fixed' as const, fixed_rate: 0.03, term_years: 0 },
    };
    expect(fieldErrors(noLoan)).toEqual({});
    expect(fieldErrors({ ...noLoan, ltv: 0.5 })).toEqual({ 'loan.term_years': 'error.outOfRange' });
  });

  it('ignores every loan field and the loan fees when there is no loan', () => {
    const emptied = {
      ...es(),
      ltv: 0,
      loan_fees: Number.NaN,
      loan: {
        kind: 'mixed' as const,
        fixed_rate: Number.NaN,
        fixed_years: Number.NaN,
        spread: Number.NaN,
        index: Number.NaN,
        index_path: [Number.NaN],
        term_years: Number.NaN,
      },
    };
    expect(fieldErrors(emptied)).toEqual({});
    expect(Object.keys(fieldErrors({ ...emptied, ltv: 0.5 }))).toEqual(
      expect.arrayContaining(['loan_fees', 'loan.fixed_rate', 'loan.spread', 'loan.index']),
    );
  });

  it('bounds the fixed years of a mixed loan by the term', () => {
    const mixed = {
      ...es(),
      loan: {
        kind: 'mixed' as const,
        fixed_rate: 0.03,
        fixed_years: 26,
        spread: 0.01,
        index: 0.02,
        term_years: 25,
      },
    };
    expect(fieldErrors(mixed)).toEqual({ 'loan.fixed_years': 'error.outOfRange' });
  });

  it('flags the position of a bad index path entry', () => {
    const variable = {
      ...es(),
      loan: {
        kind: 'variable' as const,
        spread: 0.01,
        index: 0.02,
        index_path: [0.02, 0.5],
        term_years: 25,
      },
    };
    expect(fieldErrors(variable)).toEqual({ 'loan.index_path[1]': 'error.outOfRange' });
  });

  it('flags the generic profile fields under their paths', () => {
    const bad = {
      ...defaultInputs('us-example'),
      purchase: {
        transfer_tax_rate: 0.6,
        closing_cost_rate: 0,
        closing_cost_fixed: -1,
        buyer_agency_rate: 0,
      },
      property_tax_rate: 0.06,
    };
    expect(fieldErrors(bad)).toEqual({
      property_tax_rate: 'error.outOfRange',
      'purchase.transfer_tax_rate': 'error.outOfRange',
      'purchase.closing_cost_fixed': 'error.outOfRange',
    });
  });

  it('accepts 0 and 27.5 depreciation years but not 0.5', () => {
    const us = defaultInputs('us-example');
    const withYears = (depreciation_years: number): Inputs => ({
      ...us,
      tax: { ...defaultTax('us-example'), depreciation_years },
    });
    expect(fieldErrors(withYears(0))).toEqual({});
    expect(fieldErrors(withYears(27.5))).toEqual({});
    expect(fieldErrors(withYears(0.5))).toEqual({ 'tax.depreciation_years': 'error.outOfRange' });
  });

  it('ignores the fields of the other profile', () => {
    const spainWithGenericBits = { ...es(), property_tax_rate: 9, purchase: undefined };
    expect(fieldErrors(spainWithGenericBits as Inputs)).toEqual({});
  });
});

describe('validate (Monte Carlo)', () => {
  const { params } = defaultMc;

  it('flags n 100 001 as too many scenarios and n 100 000 as fine', () => {
    expect(mcFieldErrors(100_001, params)).toEqual({ n: 'error.tooManyScenarios' });
    expect(mcFieldErrors(100_000, params)).toEqual({});
  });

  it('flags n 0 as out of range', () => {
    expect(mcFieldErrors(0, params)).toEqual({ n: 'error.outOfRange' });
  });

  it('flags kappa 1.1 and sigma_app 0.6', () => {
    expect(mcFieldErrors(1000, { ...params, kappa: 1.1, sigma_app: 0.6 })).toEqual({
      'params.kappa': 'error.outOfRange',
      'params.sigma_app': 'error.outOfRange',
    });
  });

  it('flags an asymmetric matrix and one that is not positive definite', () => {
    const asymmetric = params.corr.map((row) => [...row]);
    (asymmetric[0] as number[])[1] = 0.2;
    expect(mcFieldErrors(1000, { ...params, corr: asymmetric })).toEqual({
      'params.corr': 'error.badCorrelation',
    });
    const singular = [
      [1, 1, 0, 0],
      [1, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    expect(mcFieldErrors(1000, { ...params, corr: singular })).toEqual({
      'params.corr': 'error.badCorrelation',
    });
  });
});

describe('namedInputs', () => {
  it('names a loaded example after its title in the page language: «Resale flat, Madrid»', () => {
    const madrid = examples[0] as (typeof examples)[number];
    expect(namedInputs(madrid, 'en').name).toBe('Resale flat, Madrid');
    expect(namedInputs(madrid, 'es').name).toBe('Piso de segunda mano, Madrid');
  });
});
