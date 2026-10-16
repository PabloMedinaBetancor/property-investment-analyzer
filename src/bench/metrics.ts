import type { Irr } from '../engine/types';

export type Flows = readonly number[] | Float64Array;

// Loops over flows use an index and cast the read: V8 runs `for…of` over a typed
// array about 2.4× slower (10 000 scenarios × 10 years: 260 ms against 110 ms), and
// noUncheckedIndexedAccess types every read as possibly undefined.

const LOWEST_RATE = -0.99;
const HIGHEST_RATE = 10;
// Descartes: at most one root per sign change, and a hold is at most 40 years.
export const MAX_ROOTS = 41;

// −0.99 … 1.00 in steps of 0.01, then 1.1 … 10.0 in steps of 0.1, as exact quotients.
const GRID_RATE = Float64Array.from({ length: 291 }, (_, k) =>
  k < 200 ? (k - 99) / 100 : 1 + (k - 199) / 10,
);
const GRID_X = GRID_RATE.map((rate) => 1 / (1 + rate));

/** NPV at the discount factor x = 1/(1+rate); the first flow is not discounted. */
function presentValue(x: number, flows: Flows): number {
  let sum = 0;
  let power = 1;
  for (let t = 0; t < flows.length; t++) {
    sum += (flows[t] as number) * power;
    power *= x;
  }
  return sum;
}

export function npv(rate: number, flows: Flows): number {
  return presentValue(1 / (1 + rate), flows);
}

export function signChanges(flows: Flows): number {
  let changes = 0;
  let previous = 0;
  for (let t = 0; t < flows.length; t++) {
    const flow = flows[t] as number;
    if (flow === 0) continue;
    const sign = flow > 0 ? 1 : -1;
    if (previous !== 0 && sign !== previous) changes++;
    previous = sign;
  }
  return changes;
}

/** Fills `roots` ascending with every root in [−0.99, 10] and returns how many. */
function scan(flows: Flows, roots: Float64Array): number {
  let count = 0;
  let previous = presentValue(GRID_X[0] as number, flows);
  if (previous === 0) roots[count++] = LOWEST_RATE;
  for (let k = 1; k < GRID_RATE.length; k++) {
    const value = presentValue(GRID_X[k] as number, flows);
    if (value === 0) {
      roots[count++] = GRID_RATE[k] as number;
    } else if (previous * value < 0) {
      roots[count++] = bisect(flows, GRID_RATE[k - 1] as number, GRID_RATE[k] as number, previous);
    }
    previous = value;
  }
  return count;
}

function bisect(flows: Flows, low: number, high: number, valueLow: number): number {
  let a = low;
  let b = high;
  let fa = valueLow;
  for (let step = 0; step < 200; step++) {
    const mid = (a + b) / 2;
    const fm = npv(mid, flows);
    if (fm === 0 || (b - a) / 2 < 1e-15) break;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

export function irr(flows: Flows): Irr {
  if (signChanges(flows) === 0) return { kind: 'None', reason: 'NoSignChange' };
  const roots = new Float64Array(MAX_ROOTS);
  const count = scan(flows, roots);
  if (count === 0) return { kind: 'None', reason: 'OutOfRange' };
  if (count === 1) return { kind: 'Unique', rate: roots[0] as number };
  return { kind: 'Multiple', rates: Array.from(roots.subarray(0, count)) };
}

/**
 * The IRR of one Monte Carlo scenario without allocating: the rate, NaN when
 * several IRRs exist, or ±Infinity when there is none (the sign of the total
 * flow: a scenario that lost money ranks at the bottom, one that did not at the top).
 */
export function scenarioIrr(flows: Flows, roots: Float64Array): number {
  const changes = signChanges(flows);
  if (changes === 0) return noRoot(flows);
  if (changes > 1) {
    const count = scan(flows, roots);
    if (count === 0) return noRoot(flows);
    return count === 1 ? (roots[0] as number) : Number.NaN;
  }
  const root = newtonRoot(flows);
  return root === null ? noRoot(flows) : root;
}

function noRoot(flows: Flows): number {
  let total = 0;
  for (let t = 0; t < flows.length; t++) total += flows[t] as number;
  return total < 0 ? -Infinity : Infinity;
}

// With one sign change the root is unique (Descartes on x = 1/(1+r)), so the
// bracket [−0.99, 10] holds it exactly when the ends differ in sign. Same
// safeguard as the engine: a Newton step is taken only when it stays inside
// the bracket and is at most half the previous step, else the bracket is
// bisected.
export function newtonRoot(flows: Flows, used?: { count: number }): number | null {
  const valueLow = npv(LOWEST_RATE, flows);
  const valueHigh = npv(HIGHEST_RATE, flows);
  if (valueLow === 0) return LOWEST_RATE;
  if (valueHigh === 0) return HIGHEST_RATE;
  if (valueLow * valueHigh > 0) return null;
  let a = LOWEST_RATE;
  let b = HIGHEST_RATE;
  let rate = 0.1;
  let previous = b - a;
  for (let step = 0; step < 200; step++) {
    if (used) used.count = step + 1;
    const x = 1 / (1 + rate);
    let value = 0;
    let weighted = 0;
    let power = 1;
    for (let t = 0; t < flows.length; t++) {
      const flow = flows[t] as number;
      value += flow * power;
      weighted += t * flow * power;
      power *= x;
    }
    if (value === 0) return rate;
    if (value * valueLow > 0) a = rate;
    else b = rate;
    // d(NPV)/dr = −x · Σ t·cf·x^t
    const next = rate + value / (x * weighted);
    if (Math.abs(next - rate) < 1e-13 && next >= a && next <= b) return next;
    const inside = next > a && next < b && Math.abs(next - rate) <= previous / 2;
    const candidate = inside ? next : (a + b) / 2;
    const moved = Math.abs(candidate - rate);
    previous = moved;
    rate = candidate;
    if (moved < 1e-13 || b - a < 1e-13) break;
  }
  return rate;
}

/** Type 7 percentile of an ascending array; next to ±Infinity the result stays infinite. */
export function percentile7(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const frac = h - lo;
  const low = sorted[lo] as number;
  if (frac === 0 || lo + 1 >= sorted.length) return low;
  const high = sorted[lo + 1] as number;
  if (low === -Infinity) return -Infinity;
  if (high === Infinity) return Infinity;
  return low + frac * (high - low);
}
