import { startEngine } from './client';
import type { EngineClient } from './client';

let engine: EngineClient | undefined;

// One engine (one worker, one wasm module) for every page that does not receive its own client.
export function sharedEngine(): EngineClient {
  engine ??= startEngine();
  return engine;
}
