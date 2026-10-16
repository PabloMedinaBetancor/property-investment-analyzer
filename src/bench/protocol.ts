import type { Inputs, McParams, McResult } from '../engine/types';
import { percentile7 } from './metrics';

// The timing protocol, free of any clock or engine so a test can
// drive it with a fake clock.
export type Summary = Omit<McResult, 'npv_histogram'>;

export interface Contender {
  run(seed: number): Summary;
}

export type Clock = () => number;

export const WARMUPS = 3;
export const PAIRS = 15;
// The page is not cross-origin isolated, so its timer is coarse (~0.1 ms):
// a sample shorter than this is repeated and divided.
export const MIN_SAMPLE_MS = 20;
const MAX_REPEATS = 1000;
const PARITY_TOLERANCE = 1e-9;

export interface Timing {
  median: number;
  min: number;
  p90: number;
  scenariosPerSecond: number;
  samples: number[];
  checksum: number;
}

export interface ParityReport {
  ok: boolean;
  worst: number;
  mismatches: string[];
}

export interface Comparison {
  n: number;
  wasm: Timing;
  js: Timing;
  ratio: number;
}

export type Implementation = 'wasm' | 'js';

export interface BenchRequest {
  id: number;
  inputs: Inputs;
  params: McParams;
  n: number;
  seed: number;
}

export interface Environment {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  date: string;
}

export interface ColdStart {
  wasmMs: number;
  jsMs: number;
}

export interface BenchReport extends Comparison {
  years: number;
  seed: number;
  coldStart: ColdStart;
  environment: Environment;
}

export type BenchEvent =
  | { id: number; type: 'parity'; parity: ParityReport }
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; report: BenchReport }
  | { id: number; type: 'error'; message: string };

function relativeDifference(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
}

// Percentiles may be "below" or "above" in the IRR points; they must agree exactly.
function pointDifference(a: number | string | undefined, b: number | string | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return relativeDifference(a, b);
  return a === b ? 0 : Infinity;
}

export function parity(a: Summary, b: Summary): ParityReport {
  const mismatches: string[] = [];
  let worst = 0;
  const check = (name: string, difference: number): void => {
    worst = Math.max(worst, difference);
    if (!(difference <= PARITY_TOLERANCE)) mismatches.push(name);
  };
  for (let i = 0; i < 3; i++) {
    check(
      `npv_p[${String(i)}]`,
      relativeDifference(a.npv_p[i] ?? Number.NaN, b.npv_p[i] ?? Number.NaN),
    );
    if (a.irr_p === null || b.irr_p === null) {
      if (a.irr_p !== b.irr_p) check('irr_p', Infinity);
    } else {
      check(`irr_p[${String(i)}]`, pointDifference(a.irr_p[i], b.irr_p[i]));
    }
  }
  check('p_npv_negative', relativeDifference(a.p_npv_negative, b.p_npv_negative));
  check('irr_multiple_count', relativeDifference(a.irr_multiple_count, b.irr_multiple_count));
  check('irr_bottom_count', relativeDifference(a.irr_bottom_count, b.irr_bottom_count));
  check('irr_top_count', relativeDifference(a.irr_top_count, b.irr_top_count));
  check('cum_p_by_year.length', relativeDifference(a.cum_p_by_year.length, b.cum_p_by_year.length));
  a.cum_p_by_year.forEach((row, t) => {
    const other = b.cum_p_by_year[t];
    row.forEach((value, i) => {
      check(
        `cum_p_by_year[${String(t)}][${String(i)}]`,
        relativeDifference(value, other?.[i] ?? Number.NaN),
      );
    });
  });
  return { ok: mismatches.length === 0, worst, mismatches };
}

// Reading every percentile of the last year keeps the result alive.
function checksum(result: Summary): number {
  const lastYear = result.cum_p_by_year.at(-1) ?? [0, 0, 0];
  return (
    result.npv_p[0] +
    result.npv_p[1] +
    result.npv_p[2] +
    result.p_npv_negative +
    lastYear[0] +
    lastYear[1] +
    lastYear[2]
  );
}

function timeCall(
  contender: Contender,
  seed: number,
  clock: Clock,
): { ms: number; checksum: number } {
  const start = clock();
  let last = contender.run(seed);
  const elapsed = clock() - start;
  if (elapsed >= MIN_SAMPLE_MS) return { ms: elapsed, checksum: checksum(last) };
  const repeats =
    elapsed > 0 ? Math.min(MAX_REPEATS, Math.ceil(MIN_SAMPLE_MS / elapsed)) : MAX_REPEATS;
  const repeatStart = clock();
  for (let i = 0; i < repeats; i++) last = contender.run(seed);
  return { ms: (clock() - repeatStart) / repeats, checksum: checksum(last) };
}

function summarise(samples: number[], n: number, total: number): Timing {
  const sorted = Float64Array.from(samples).sort();
  const median = percentile7(sorted, 0.5);
  return {
    median,
    min: sorted[0] ?? Number.NaN,
    p90: percentile7(sorted, 0.9),
    scenariosPerSecond: n / (median / 1000),
    samples,
    checksum: total,
  };
}

export interface Contenders {
  wasm: Contender;
  js: Contender;
}

// Warm-up, then PAIRS timed pairs in alternating order. Both implementations of a
// pair use the same seed; the seed changes from pair to pair.
function compare(
  contenders: Contenders,
  n: number,
  baseSeed: number,
  clock: Clock,
  onProgress: (done: number, total: number) => void,
): Comparison {
  for (let i = 0; i < WARMUPS; i++) {
    contenders.wasm.run(baseSeed);
    contenders.js.run(baseSeed);
  }
  const samples = { wasm: [] as number[], js: [] as number[] };
  const sums = { wasm: 0, js: 0 };
  const total = 2 * PAIRS;
  let done = 0;
  for (let pair = 0; pair < PAIRS; pair++) {
    const order: Implementation[] = pair % 2 === 0 ? ['wasm', 'js'] : ['js', 'wasm'];
    for (const name of order) {
      const sample = timeCall(contenders[name], baseSeed + pair, clock);
      samples[name].push(sample.ms);
      sums[name] += sample.checksum;
      onProgress(++done, total);
    }
  }
  const wasm = summarise(samples.wasm, n, sums.wasm);
  const js = summarise(samples.js, n, sums.js);
  return { n, wasm, js, ratio: js.median / wasm.median };
}

export interface Hooks {
  onParity: (report: ParityReport) => void;
  onProgress: (done: number, total: number) => void;
}

/** A fast wrong answer is not a result: when the parity gate fails nothing is timed and null comes back. */
export function benchmark(
  contenders: Contenders,
  n: number,
  seed: number,
  clock: Clock,
  hooks: Hooks,
): Comparison | null {
  const gate = parity(contenders.wasm.run(seed), contenders.js.run(seed));
  hooks.onParity(gate);
  return gate.ok ? compare(contenders, n, seed, clock, hooks.onProgress) : null;
}
