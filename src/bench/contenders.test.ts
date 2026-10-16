import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine, type Engine } from '../engine/abi';
import type { Inputs, McParams } from '../engine/types';
import { contenders } from './contenders';
import { fixture } from './fixtures';
import { Simulator } from './kernel';
import { PAIRS, benchmark } from './protocol';

interface McFixture {
  params: McParams;
  n: number;
  seed: number;
}

let engine: Engine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(resolve('src/engine/invest_engine.wasm')));
});

// A clock that moves 25 ms per reading: every sample is above the repeat threshold.
function steppedClock(): () => number {
  let now = 0;
  return () => (now += 25);
}

describe('the wasm engine and the kernel on the committed Monte Carlo cases', () => {
  it.each([
    ['F1', 'monte_carlo_F1_n2000_seed42'],
    ['F2', 'monte_carlo_F2_n2000_seed42'],
    ['F3', 'monte_carlo_F3_n500_seed7'],
  ])('%s: the kernel agrees with the wasm at 1e-9 and 15 pairs are timed', (base, name) => {
    const { params, n, seed } = fixture(name) as McFixture;
    const { inputs } = fixture(`proforma_${base}`) as { inputs: Inputs };
    const events: string[] = [];
    const comparison = benchmark(
      contenders(engine, new Simulator(), inputs, params, n),
      n,
      seed,
      steppedClock(),
      {
        onParity: (parity) => {
          events.push(parity.ok ? 'parity ok' : `parity failed: ${parity.mismatches.join(', ')}`);
        },
        onProgress: () => undefined,
      },
    );
    expect(events).toEqual(['parity ok']);
    expect(comparison?.wasm.samples).toHaveLength(PAIRS);
    expect(comparison?.js.samples).toHaveLength(PAIRS);
  });

  it('an engine error reaches the caller as its code, field and message', () => {
    const { params, n } = fixture('monte_carlo_F2_n2000_seed42') as McFixture;
    const { inputs } = fixture('proforma_F2') as { inputs: Inputs };
    const broken = { ...inputs, price: -1 };
    expect(() => contenders(engine, new Simulator(), broken, params, n)).toThrow(/price/);
  });
});
