import { describe, expect, it } from 'vitest';
import type { Irr } from '../engine/types';
import { close, fixture } from './fixtures';
import { MAX_ROOTS, irr, newtonRoot, npv, percentile7, scenarioIrr, signChanges } from './metrics';

interface IrrCase {
  flows: number[];
  irr: Irr;
  npv_at_10pct: number;
  note: string;
}

interface NpvCase {
  rate: number;
  flows_t0_first: number[];
  npv: number;
}

interface PercentileCase {
  data: (number | string)[];
  p: number;
  value: number | string;
}

const cases = fixture('irr') as IrrCase[];
const decode = (v: number | string): number =>
  typeof v === 'number' ? v : v === 'inf' ? Infinity : -Infinity;

describe('irr', () => {
  it.each(cases)('$note: $flows', ({ flows, irr: expected }) => {
    const found = irr(flows);
    expect(found.kind).toBe(expected.kind);
    if (found.kind === 'Unique' && expected.kind === 'Unique') {
      expect(close(found.rate, expected.rate)).toBe(true);
    } else if (found.kind === 'Multiple' && expected.kind === 'Multiple') {
      expect(found.rates).toHaveLength(expected.rates.length);
      found.rates.forEach((rate, i) => {
        expect(close(rate, expected.rates[i] as number)).toBe(true);
      });
    } else if (found.kind === 'None' && expected.kind === 'None') {
      expect(found.reason).toBe(expected.reason);
    }
  });

  it('finds both roots of [-100, 230, -132]: 10 % and 20 %', () => {
    expect(irr([-100, 230, -132])).toEqual({
      kind: 'Multiple',
      rates: [expect.closeTo(0.1, 12), expect.closeTo(0.2, 12)],
    });
  });
});

describe('scenarioIrr', () => {
  const roots = new Float64Array(MAX_ROOTS);

  it.each(cases)('agrees with the fixture: $note', ({ flows, irr: expected }) => {
    const found = scenarioIrr(Float64Array.from(flows), roots);
    if (expected.kind === 'Unique') {
      expect(close(found, expected.rate)).toBe(true);
    } else if (expected.kind === 'Multiple') {
      expect(found).toBeNaN();
    } else {
      const total = flows.reduce((sum, flow) => sum + flow, 0);
      expect(found).toBe(total < 0 ? -Infinity : Infinity);
    }
  });

  it('finds 9 900 % as no root, ranked at the top', () => {
    expect(scenarioIrr(Float64Array.from([-1, 100]), roots)).toBe(Infinity);
  });

  it('finds -98 % with the Newton path: [-100, 2]', () => {
    expect(scenarioIrr(Float64Array.from([-100, 2]), roots)).toBeCloseTo(-0.98, 12);
  });
});

describe('newtonRoot', () => {
  const longHold = [
    -612381, -30272, -29880, -29466, -29027, -28562, -28070, -27549, -26998, -26414, -25796, -25142,
    -24450, -23717, -22941, -22121, -21252, -20332, -19358, 15890, 13066, 13848, 14676, 15553,
    16480, 17462, 18502, 19602, 20766, 21998, 23303, 24683, 26144, 27691, 28196, 1279481,
  ];

  it('converges on the 35-year case in few iterations, as the engine does', () => {
    const used = { count: 0 };
    const rate = newtonRoot(Float64Array.from(longHold), used);
    expect(rate).toBeCloseTo(0.0134019, 6);
    expect(used.count).toBeLessThanOrEqual(20);
  });

  it('needs few iterations on average over typical one-sign-change flows', () => {
    let total = 0;
    let cases = 0;
    for (const years of [10, 30]) {
      for (const equity of [30000, 60000, 120000, 230000]) {
        for (const running of [-3000, -500, 1000, 4000]) {
          for (const multiple of [0.7, 1, 1.5, 2.2]) {
            const flows = [-equity];
            for (let t = 1; t < years; t++) flows.push(running * 1.02 ** t);
            flows.push(running + equity * multiple);
            if (signChanges(Float64Array.from(flows)) !== 1) continue;
            const used = { count: 0 };
            const rate = newtonRoot(Float64Array.from(flows), used);
            if (rate === null || rate < -0.5) continue;
            expect(used.count).toBeLessThanOrEqual(30);
            expect(Math.abs(npv(rate, Float64Array.from(flows)))).toBeLessThan(1e-6 * equity);
            total += used.count;
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(40);
    expect(total / cases).toBeLessThan(12);
  });
});

describe('npv', () => {
  it.each(fixture('npv') as NpvCase[])(
    'does not discount the first flow: $flows_t0_first at $rate',
    (c) => {
      expect(close(npv(c.rate, c.flows_t0_first), c.npv)).toBe(true);
      expect(npv(0.1, [-10000, 3000, 4200, 6800])).toBeCloseTo(1307.29, 2);
    },
  );
});

describe('signChanges', () => {
  it('skips zero flows: [0, -100, 0, 121] has one change', () => {
    expect(signChanges([0, -100, 0, 121])).toBe(1);
  });

  it('counts two changes in [-100, 230, -132]', () => {
    expect(signChanges([-100, 230, -132])).toBe(2);
  });
});

describe('percentile7', () => {
  it.each(fixture('percentile_type7') as PercentileCase[])(
    '$data at p = $p is $value',
    ({ data, p, value }) => {
      const sorted = Float64Array.from(data.map(decode));
      expect(close(percentile7(sorted, p), decode(value))).toBe(true);
    },
  );
});
