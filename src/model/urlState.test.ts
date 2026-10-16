import { describe, expect, it } from 'vitest';
import type { Inputs } from '../engine/types';
import { defaultInputs, defaultMc, defaultTax } from './defaults';
import { examples } from './examples';
import { fieldErrors } from './validate';
import { decode, encode } from './urlState';

// mulberry32: the seeded draws keep the 200 cases the same on every run.
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInputs(next: () => number): Inputs {
  const between = (min: number, max: number) => min + (max - min) * next();
  const round = (x: number, digits: number) => Number(x.toFixed(digits)) + 0;
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)] as T;
  const generic = next() < 0.4;
  const inputs = defaultInputs(generic ? 'generic' : 'es', pick(['MD', 'VC', 'CN', 'CT', 'AN']));
  const term = Math.ceil(between(1, 40));
  const spread = round(between(-0.01, 0.05), 4);
  const index = round(between(-0.01, 0.06), 4);
  const kind = pick(['fixed', 'variable', 'mixed'] as const);
  const loan =
    kind === 'fixed'
      ? { kind, fixed_rate: round(between(0, 0.12), 4), term_years: term }
      : kind === 'variable'
        ? {
            kind,
            spread,
            index,
            term_years: term,
            ...(next() < 0.5
              ? { index_path: [0.03, 0.025, 0.02].slice(0, 1 + Math.floor(next() * 3)) }
              : {}),
          }
        : {
            kind,
            fixed_rate: round(between(0, 0.1), 4),
            fixed_years: Math.floor(between(0, term)),
            spread,
            index,
            term_years: term,
          };
  const tax =
    next() < 0.3
      ? { on: false }
      : {
          ...defaultTax(generic ? 'generic' : 'es'),
          [generic ? 'rate' : 'marginal']: round(between(0.1, 0.5), 2),
        };
  const changed: Inputs = {
    ...inputs,
    price: Math.round(between(50_000, 900_000)),
    renovation: Math.round(between(0, 90_000)),
    ltv: round(between(0, 0.9), 2),
    loan,
    rent_month: Math.round(between(300, 4000)),
    vacancy: round(between(0, 0.3), 3),
    maintenance_rate: round(between(0, 0.15), 3),
    g_rent: round(between(-0.02, 0.06), 3),
    g_app: round(between(-0.03, 0.06), 3),
    years: Math.ceil(between(1, 40)),
    discount_rate: round(between(0, 0.12), 3),
    tax,
    ...(next() < 0.5 ? { name: `Case ${Math.floor(between(1, 999)).toString()} é ñ` } : {}),
  };
  if (!generic && next() < 0.5) changed.reference_value = Math.round(between(80_000, 500_000));
  if (!generic && next() < 0.3) changed.manual_transfer_rate = round(between(0.02, 0.1), 3);
  return changed;
}

function toBase64Url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('urlState', () => {
  it.each(examples)('round trip is exact for the example $id', ({ inputs }) => {
    expect(decode(encode(inputs))).toEqual({ inputs });
  });

  it('round trip is exact for 200 seeded random valid inputs', () => {
    const next = random(2026);
    for (let i = 0; i < 200; i++) {
      const inputs = randomInputs(next);
      expect(fieldErrors(inputs), `case ${i.toString()} must be valid`).toEqual({});
      expect(decode(encode(inputs)), `case ${i.toString()}`).toEqual({ inputs });
    }
  });

  it('the Madrid example link, with its prefix, is under 400 characters', () => {
    const madrid = examples.find((e) => e.id === 'madrid');
    const link = `#/?s=${encode(madrid?.inputs as Inputs)}`;
    expect(link.length).toBeLessThan(400);
  });

  it('a payload carries only what differs from the defaults', () => {
    const payload = encode(defaultInputs('es')).split('.')[1] ?? '';
    expect(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).toBe('{"profile":"es"}');
  });

  it('version 2 is refused as a version error', () => {
    expect(decode('2.eyJwcm9maWxlIjoiZXMifQ')).toEqual({ error: 'version' });
  });

  it.each([
    ['not base64', '1.@@@'],
    ['not JSON', `1.${btoa('hello')}`],
    ['a JSON array', `1.${btoa('[1,2]')}`],
    ['an unknown profile', `1.${btoa('{"profile":"fr"}')}`],
    ['a price that is text', `1.${btoa('{"profile":"es","price":"abc"}')}`],
    ['a field that does not exist', `1.${btoa('{"profile":"es","colour":1}')}`],
    ['a loan that is a number', `1.${btoa('{"profile":"es","loan":5}')}`],
  ])('%s gives a payload error', (_what, text) => {
    expect(decode(text)).toEqual({ error: 'payload' });
  });

  // A name or starting value of the wrong type used to get through and crash Compare (a React child) and Save (.trim).
  it.each([
    ['a name that is an object', { name: {} }],
    ['a name that is a number', { name: 5 }],
    ['a name that is a list', { name: ['a'] }],
    ['a name that is true', { name: true }],
    ['a name that is null', { name: null }],
    ['a starting value that is text', { value0: 'x' }],
    ['a starting value that is an object', { value0: {} }],
    ['a starting value that is true', { value0: true }],
    ['a field of the loan that is text', { loan: { kind: 'fixed', fixed_rate: 'x' } }],
    ['a field of the tax that is text', { tax: { on: true, marginal: 'x' } }],
    ['a flag of the tax that is a number', { tax: { on: true, offset_other_income: 1 } }],
    ['an unknown key in the tax', { tax: { on: true, salary: -1 } }],
    ['an unknown key in the loan', { loan: { kind: 'fixed', colour: 1 } }],
    ['an unknown key in the purchase', { profile: 'generic', purchase: { colour: 1 } }],
    [
      'a field of the purchase that is text',
      { profile: 'generic', purchase: { closing_cost_fixed: 'x' } },
    ],
    ['a name that is not well formed', { name: '\ud800' }],
  ])('%s gives a payload error', (_what, changes) => {
    const text = `1.${toBase64Url(JSON.stringify({ profile: 'es', ...changes }))}`;
    expect(decode(text)).toEqual({ error: 'payload' });
  });

  it.each([
    ['a name and a starting value', { name: 'Flat é ñ 😀', value0: 250000 }],
    ['a starting value that is null', { value0: null }],
    ["a tax with the other profile's fields", { tax: { on: true, rate: 0.2, marginal: 0.3 } }],
  ])('%s still reads', (_what, changes) => {
    const text = `1.${toBase64Url(JSON.stringify({ profile: 'es', ...changes }))}`;
    expect(decode(text)).toHaveProperty('inputs');
  });

  it('text without a version dot gives a version error', () => {
    expect(decode('garbage')).toEqual({ error: 'version' });
  });

  describe('the simulation settings', () => {
    const madrid = examples[0]?.inputs as Inputs;
    const corr = defaultMc.params.corr.map((row) => [...row]);
    corr[0] = [1, 0.25, 0, 0.3];
    corr[1] = [0.25, 1, 0.5, 0.4];
    const changedMc = { ...defaultMc, seed: 7, params: { ...defaultMc.params, corr } };
    const text = (payload: string) => atob(payload.replace(/-/g, '+').replace(/_/g, '/'));

    it('round trip is exact with seed 7 and the correlation of index and rent at 0.25', () => {
      expect(decode(encode(madrid, changedMc))).toEqual({ inputs: madrid, mc: changedMc });
    });

    it('the link carries only the settings that differ: seed 7 alone is {"seed":7}', () => {
      const payload = encode(defaultInputs('es'), { ...defaultMc, seed: 7 }).split('.')[1] ?? '';
      expect(text(payload)).toBe('{"profile":"es","mc":{"seed":7}}');
    });

    it('the default settings add nothing, and a link without them reads as before', () => {
      expect(encode(madrid, defaultMc)).toBe(encode(madrid));
      expect(decode(encode(madrid))).toEqual({ inputs: madrid });
    });

    it.each([
      ['a volatility above 50 %', '{"params":{"sigma_rent":0.9}}'],
      ['zero scenarios', '{"n":0}'],
      ['a seed that is text', '{"seed":"x"}'],
      ['a setting that does not exist', '{"steps":3}'],
      ['a parameter that does not exist', '{"params":{"drift":1}}'],
      [
        'a matrix that is not symmetric',
        '{"params":{"corr":[[1,0.9,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}}',
      ],
      ['a matrix of the wrong size', '{"params":{"corr":[[1]]}}'],
      ['settings that are a number', '5'],
    ])('%s gives a payload error', (_what, mc) => {
      expect(decode(`1.${btoa(`{"profile":"es","mc":${mc}}`)}`)).toEqual({ error: 'payload' });
    });
  });

  it('refuses a currency that is not a three-letter code, which would stop the page rendering', () => {
    const generic = defaultInputs('generic');
    expect(decode(encode({ ...generic, currency: 'EURO' }))).toEqual({ error: 'payload' });
    expect(decode(encode({ ...generic, currency: '€' }))).toEqual({ error: 'payload' });
    expect(decode(encode({ ...generic, currency: 'GBP' }))).toEqual({
      inputs: { ...generic, currency: 'GBP' },
    });
  });
});
