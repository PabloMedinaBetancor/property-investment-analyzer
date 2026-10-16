import { parseEnvelope, type Engine, type Op } from '../engine/abi';
import type { Analysis, Inputs, McParams, McResult } from '../engine/types';
import type { Simulator } from './kernel';
import type { Contenders } from './protocol';

function call(engine: Engine, op: Op, request: unknown): unknown {
  const envelope = parseEnvelope(engine.run(op, JSON.stringify(request)));
  if (!envelope.ok) {
    const { code, field, message } = envelope.error;
    throw new Error(`${code} at ${field}: ${message}`);
  }
  return envelope.value;
}

// The wasm side pays for its JSON in and out on every call, as the app does; the
// kernel is handed the acquisition once because that part of simulate is not timed.
export function contenders(
  engine: Engine,
  simulator: Simulator,
  inputs: Inputs,
  params: McParams,
  n: number,
): Contenders {
  const { acquisition } = call(engine, 'analyze', inputs) as Analysis;
  return {
    wasm: { run: (seed) => call(engine, 'simulate', { inputs, params, n, seed }) as McResult },
    js: { run: (seed) => simulator.run({ inputs, acquisition, params, n, seed }) },
  };
}
