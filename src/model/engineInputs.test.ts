import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine, parseEnvelope, type Engine } from '../engine/abi';
import type { Inputs } from '../engine/types';
import { forEngine } from './engineInputs';

const f1 = (
  JSON.parse(readFileSync(resolve('tests/fixtures', 'proforma_F1.json'), 'utf8')) as {
    inputs: Inputs;
  }
).inputs;

let engine: Engine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(resolve('src/engine/invest_engine.wasm')));
});

const emptied = (kind: 'fixed' | 'variable' | 'mixed'): Inputs => ({
  ...f1,
  ltv: 0,
  loan_fees: Number.NaN,
  loan:
    kind === 'fixed'
      ? { kind, fixed_rate: Number.NaN, term_years: Number.NaN }
      : kind === 'variable'
        ? { kind, spread: Number.NaN, index: Number.NaN, term_years: Number.NaN }
        : {
            kind,
            fixed_rate: Number.NaN,
            fixed_years: Number.NaN,
            spread: Number.NaN,
            index: Number.NaN,
            term_years: Number.NaN,
          },
});

describe('forEngine', () => {
  it.each(['fixed', 'variable', 'mixed'] as const)(
    'lets the engine analyse a %s loan with every field emptied when there is no loan',
    (kind) => {
      const envelope = parseEnvelope(
        engine.run('analyze', JSON.stringify(forEngine(emptied(kind)))),
      );
      expect(envelope.ok).toBe(true);
    },
  );

  it('would otherwise send nulls the engine refuses', () => {
    const envelope = parseEnvelope(engine.run('analyze', JSON.stringify(emptied('fixed'))));
    expect(envelope.ok).toBe(false);
  });

  it('keeps the fields the person did type, and leaves a loan alone', () => {
    const typed: Inputs = {
      ...f1,
      ltv: 0,
      loan: { kind: 'fixed', fixed_rate: 0.05, term_years: Number.NaN },
    };
    expect(forEngine(typed).loan).toEqual({ kind: 'fixed', fixed_rate: 0.05, term_years: 25 });
    const borrowing = { ...emptied('fixed'), ltv: 0.5 };
    expect(forEngine(borrowing)).toBe(borrowing);
  });

  it('gives the same result as the typed inputs, since the engine ignores the loan', () => {
    const base = parseEnvelope(engine.run('analyze', JSON.stringify({ ...f1, ltv: 0 })));
    const blank = parseEnvelope(engine.run('analyze', JSON.stringify(forEngine(emptied('mixed')))));
    expect(blank).toEqual(base);
  });

  it('sends values the engine accepts when there is no loan and a loan field holds a bad value', () => {
    const run = (inputs: Inputs) =>
      parseEnvelope(engine.run('analyze', JSON.stringify(forEngine(inputs))));
    const mixed =
      f1.loan.kind === 'mixed'
        ? f1.loan
        : {
            kind: 'mixed' as const,
            fixed_rate: 0.03,
            fixed_years: 5,
            spread: 0.01,
            index: 0.025,
            term_years: 25,
          };
    const bad: Inputs[] = [
      { ...f1, ltv: 0, loan_fees: -5 },
      { ...f1, ltv: 0, loan_fees: 2e8 },
      { ...f1, ltv: 0, loan: { kind: 'fixed', fixed_rate: 0.03, term_years: 2.5 } },
      { ...f1, ltv: 0, loan: { kind: 'fixed', fixed_rate: 0.03, term_years: -1 } },
      { ...f1, ltv: 0, loan: { kind: 'fixed', fixed_rate: 0.03, term_years: 41 } },
      { ...f1, ltv: 0, loan: { kind: 'variable', spread: 0.01, index: 0.02, term_years: 0 } },
      { ...f1, ltv: 0, loan: { ...mixed, fixed_years: 3.5 } },
      { ...f1, ltv: 0, loan: { ...mixed, fixed_years: -2 } },
      { ...f1, ltv: 0, loan: { ...mixed, term_years: 10, fixed_years: 30 } },
      { ...f1, ltv: 0, loan: { ...mixed, term_years: 2.5, fixed_years: 5 } },
    ];
    for (const inputs of bad) expect(run(inputs).ok, JSON.stringify(inputs.loan)).toBe(true);
    expect(forEngine(bad[0] as Inputs).loan_fees).toBe(0);
    expect((forEngine(bad[2] as Inputs).loan as { term_years: number }).term_years).toBe(25);
    expect((forEngine(bad[8] as Inputs).loan as { fixed_years: number }).fixed_years).toBe(5);
  });

  it('keeps a valid whole term and fixed years', () => {
    const typed: Inputs = {
      ...f1,
      ltv: 0,
      loan: {
        kind: 'mixed',
        fixed_rate: 0.03,
        fixed_years: 8,
        spread: 0.01,
        index: 0.02,
        term_years: 30,
      },
    };
    expect(forEngine(typed).loan).toMatchObject({ fixed_years: 8, term_years: 30 });
  });
});
