import { describe, expect, it } from 'vitest';
import type { Acquisition, Inputs, IrrPoint, McParams, McResult } from '../engine/types';
import { close, fixture } from './fixtures';
import { Simulator } from './kernel';

interface ProformaFixture {
  inputs: Inputs;
  result: { acquisition: Acquisition };
}

interface McFixture extends Omit<McResult, 'npv_histogram'> {
  params: McParams;
  n: number;
  seed: number;
}

const files = [
  ['monte_carlo_F1_n2000_seed42', 'proforma_F1'],
  ['monte_carlo_F2_n2000_seed42', 'proforma_F2'],
  ['monte_carlo_F3_n500_seed7', 'proforma_F3'],
] as const;

const point = (p: IrrPoint | undefined): number => (typeof p === 'number' ? p : Number.NaN);

describe.each(files)('Simulator on %s', (mc, proforma) => {
  const expected = fixture(mc) as McFixture;
  const { inputs, result } = fixture(proforma) as ProformaFixture;
  const found = new Simulator().run({
    inputs,
    acquisition: result.acquisition,
    params: expected.params,
    n: expected.n,
    seed: expected.seed,
  });

  it('matches the IRR percentiles and the counts of excluded scenarios', () => {
    expected.irr_p?.forEach((value, i) => {
      expect(close(point(found.irr_p?.[i]), point(value))).toBe(true);
    });
    expect(found.irr_multiple_count).toBe(expected.irr_multiple_count);
    expect(found.irr_bottom_count).toBe(expected.irr_bottom_count);
    expect(found.irr_top_count).toBe(expected.irr_top_count);
  });

  it('matches the NPV percentiles and P(NPV < 0)', () => {
    expected.npv_p.forEach((value, i) => {
      expect(close(found.npv_p[i] as number, value)).toBe(true);
    });
    expect(close(found.p_npv_negative, expected.p_npv_negative)).toBe(true);
  });

  it('matches the cumulative cash flow percentiles of every year', () => {
    expect(found.cum_p_by_year).toHaveLength(inputs.years + 1);
    expected.cum_p_by_year.forEach((row, t) => {
      row.forEach((value, i) => {
        expect(close(found.cum_p_by_year[t]?.[i] as number, value)).toBe(true);
      });
    });
  });
});

describe('Simulator', () => {
  const { inputs, result } = fixture('proforma_F1') as ProformaFixture;
  const params = (fixture('monte_carlo_F1_n2000_seed42') as McFixture).params;

  it('gives the same numbers when one instance runs twice with different sizes in between', () => {
    const simulator = new Simulator();
    const request = { inputs, acquisition: result.acquisition, params, n: 300, seed: 9 };
    const first = simulator.run(request);
    simulator.run({ ...request, n: 800, seed: 3 });
    expect(simulator.run(request)).toEqual(first);
  });

  it('rejects a correlation matrix that is not positive definite', () => {
    const corr = [
      [1, 0.9, 0.9, 0],
      [0.9, 1, -0.9, 0],
      [0.9, -0.9, 1, 0],
      [0, 0, 0, 1],
    ];
    expect(() =>
      new Simulator().run({
        inputs,
        acquisition: result.acquisition,
        params: { ...params, corr },
        n: 10,
        seed: 1,
      }),
    ).toThrow('not positive definite');
  });
});
