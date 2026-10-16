import { describe, expect, it } from 'vitest';
import {
  PAIRS,
  WARMUPS,
  benchmark,
  parity,
  type Contender,
  type ParityReport,
  type Summary,
} from './protocol';

const summary: Summary = {
  irr_p: [0.016, 0.06, 0.095],
  npv_p: [-37550.5, -8270.3, 25192.3],
  p_npv_negative: 0.6315,
  cum_p_by_year: [
    [-83507.7, -83507.7, -83507.7],
    [-84075.7, -82913.2, -81750.7],
  ],
  irr_multiple_count: 0,
  irr_bottom_count: 1,
  irr_top_count: 0,
};

// A contender that advances the fake clock by `cost` milliseconds per call.
function costing(
  clock: { now: number },
  cost: number,
  calls: number[] = [],
  result: Summary = summary,
): Contender {
  return {
    run(seed) {
      clock.now += cost;
      calls.push(seed);
      return result;
    },
  };
}

const hooks = (parities: ParityReport[] = [], progress: number[] = []) => ({
  onParity: (report: ParityReport) => parities.push(report),
  onProgress: (done: number) => progress.push(done),
});

describe('benchmark', () => {
  it('times 15 pairs after 3 warm-ups: wasm 40 ms and js 100 ms give medians 40 and 100, ratio 2.5', () => {
    const clock = { now: 0 };
    const result = benchmark(
      { wasm: costing(clock, 40), js: costing(clock, 100) },
      10000,
      42,
      () => clock.now,
      hooks(),
    );
    expect(result?.wasm.median).toBe(40);
    expect(result?.js.median).toBe(100);
    expect(result?.ratio).toBe(2.5);
    expect(result?.wasm.samples).toHaveLength(PAIRS);
    expect(result?.wasm.scenariosPerSecond).toBe(250000);
    expect(result?.js.scenariosPerSecond).toBe(100000);
  });

  it('calls each contender once for the gate, 3 times to warm up and once per pair', () => {
    const clock = { now: 0 };
    const wasmCalls: number[] = [];
    const jsCalls: number[] = [];
    benchmark(
      { wasm: costing(clock, 40, wasmCalls), js: costing(clock, 40, jsCalls) },
      10000,
      100,
      () => clock.now,
      hooks(),
    );
    expect(wasmCalls).toHaveLength(1 + WARMUPS + PAIRS);
    expect(jsCalls).toEqual(wasmCalls);
  });

  it('uses seeds 100, 101, 102… for the pairs, the same seed for both implementations of a pair', () => {
    const clock = { now: 0 };
    const wasmCalls: number[] = [];
    benchmark(
      { wasm: costing(clock, 40, wasmCalls), js: costing(clock, 40) },
      1000,
      100,
      () => clock.now,
      hooks(),
    );
    expect(wasmCalls.slice(1 + WARMUPS, 4 + WARMUPS)).toEqual([100, 101, 102]);
  });

  it('alternates which implementation goes first in each pair', () => {
    const clock = { now: 0 };
    const order: string[] = [];
    const wasm: Contender = { run: () => ((clock.now += 40), order.push('wasm'), summary) };
    const js: Contender = { run: () => ((clock.now += 40), order.push('js'), summary) };
    benchmark({ wasm, js }, 1000, 1, () => clock.now, hooks());
    const timed = order.slice(2 + 2 * WARMUPS);
    expect(timed.slice(0, 4)).toEqual(['wasm', 'js', 'js', 'wasm']);
  });

  it('repeats a call shorter than 20 ms and divides: 5 ms calls run 1 + 4 times per sample and give 5', () => {
    const clock = { now: 0 };
    const calls: number[] = [];
    const result = benchmark(
      { wasm: costing(clock, 5, calls), js: costing(clock, 5) },
      1000,
      7,
      () => clock.now,
      hooks(),
    );
    expect(result?.wasm.median).toBe(5);
    expect(calls).toHaveLength(1 + WARMUPS + PAIRS * (1 + 4));
  });

  it('reports min, median and p90 of samples that cost 31 to 45 ms', () => {
    const clock = { now: 0 };
    let call = 0;
    const wasm: Contender = {
      run() {
        call++;
        clock.now += call <= 1 + WARMUPS ? 30 : 30 + (call - 1 - WARMUPS);
        return summary;
      },
    };
    const result = benchmark({ wasm, js: costing(clock, 30) }, 1000, 7, () => clock.now, hooks());
    expect(result?.wasm.min).toBe(31);
    expect(result?.wasm.median).toBe(38);
    expect(result?.wasm.p90).toBeCloseTo(43.6, 10);
  });

  it('reports progress up to 2 × 15 timed calls', () => {
    const clock = { now: 0 };
    const progress: number[] = [];
    benchmark(
      { wasm: costing(clock, 40), js: costing(clock, 40) },
      1000,
      7,
      () => clock.now,
      hooks([], progress),
    );
    expect(progress.at(0)).toBe(1);
    expect(progress.at(-1)).toBe(2 * PAIRS);
  });

  it('times nothing when the kernels disagree by 1e-6', () => {
    const clock = { now: 0 };
    const calls: number[] = [];
    const parities: ParityReport[] = [];
    const drifted: Summary = {
      ...summary,
      npv_p: [summary.npv_p[0], summary.npv_p[1] * (1 + 1e-6), summary.npv_p[2]],
    };
    const result = benchmark(
      { wasm: costing(clock, 40, calls), js: costing(clock, 40, [], drifted) },
      1000,
      7,
      () => clock.now,
      hooks(parities),
    );
    expect(result).toBeNull();
    expect(parities).toHaveLength(1);
    expect(parities[0]?.ok).toBe(false);
    expect(parities[0]?.mismatches).toEqual(['npv_p[1]']);
    expect(calls).toHaveLength(1);
  });
});

describe('parity', () => {
  it('accepts a difference of 1e-12 relative', () => {
    const near: Summary = {
      ...summary,
      npv_p: [summary.npv_p[0], summary.npv_p[1] * (1 + 1e-12), summary.npv_p[2]],
    };
    expect(parity(summary, near).ok).toBe(true);
  });

  it('compares the cumulative percentiles of every year', () => {
    const drifted: Summary = {
      ...summary,
      cum_p_by_year: [
        [-83507.7, -83507.7, -83507.7],
        [-84075.7, -82913.2, -81750.7 * (1 + 1e-6)],
      ],
    };
    expect(parity(summary, drifted).mismatches).toEqual(['cum_p_by_year[1][2]']);
  });

  it('treats "below" and "above" as exact values', () => {
    const below: Summary = { ...summary, irr_p: ['below', 0.06, 0.095] };
    expect(parity(summary, below).mismatches).toEqual(['irr_p[0]']);
    expect(parity(below, below).ok).toBe(true);
  });

  it('flags a null irr_p on one side only', () => {
    expect(parity(summary, { ...summary, irr_p: null }).ok).toBe(false);
    expect(parity({ ...summary, irr_p: null }, { ...summary, irr_p: null }).ok).toBe(true);
  });

  it('flags different counts of excluded scenarios', () => {
    expect(parity(summary, { ...summary, irr_multiple_count: 3 }).mismatches).toEqual([
      'irr_multiple_count',
    ]);
  });
});
