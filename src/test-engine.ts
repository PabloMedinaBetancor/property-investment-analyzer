import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { EngineClient } from './engine/client';
import type { Analysis, McResult, Sensitivity } from './engine/types';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));

export const f1Analysis = (fixture('proforma_F1') as { result: Analysis }).result;
export const f1Sensitivity = fixture('sensitivity_F1') as Sensitivity;
export const f1Simulation = fixture('monte_carlo_F1_n2000_seed42') as McResult;

export type FakeEngine = { [K in keyof EngineClient]: Mock<EngineClient[K]> };

// An engine that answers at once with the F1 fixtures; tests replace single methods to control timing.
export function fakeEngine(): FakeEngine {
  return {
    analyze: vi.fn(() => Promise.resolve(f1Analysis)),
    sensitivity: vi.fn(() => Promise.resolve(f1Sensitivity)),
    simulate: vi.fn(() => Promise.resolve(f1Simulation)),
  };
}
