import { loadEngine } from '../engine/abi';
import { contenders } from './contenders';
import {
  benchmark,
  type BenchEvent,
  type BenchRequest,
  type ColdStart,
  type Environment,
} from './protocol';

// Cold starts are measured once, when the worker first needs them, and reported apart from the timings.
async function start() {
  const wasmStart = performance.now();
  const response = await fetch(new URL('../engine/invest_engine.wasm', import.meta.url));
  const engine = await loadEngine(await response.arrayBuffer());
  const wasmMs = performance.now() - wasmStart;
  const jsStart = performance.now();
  const { Simulator } = await import('./kernel');
  const coldStart: ColdStart = { wasmMs, jsMs: performance.now() - jsStart };
  return { engine, simulator: new Simulator(), coldStart };
}

let ready: ReturnType<typeof start> | undefined;

function environment(): Environment {
  const { deviceMemory } = navigator as { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: deviceMemory ?? null,
    date: new Date().toISOString(),
  };
}

async function handle({ id, inputs, params, n, seed }: BenchRequest): Promise<void> {
  const post = (event: BenchEvent): void => {
    self.postMessage(event);
  };
  try {
    ready ??= start();
    const { engine, simulator, coldStart } = await ready;
    const comparison = benchmark(
      contenders(engine, simulator, inputs, params, n),
      n,
      seed,
      () => performance.now(),
      {
        onParity: (parity) => {
          post({ id, type: 'parity', parity });
        },
        onProgress: (done, total) => {
          post({ id, type: 'progress', done, total });
        },
      },
    );
    if (comparison) {
      const report = {
        ...comparison,
        years: inputs.years,
        seed,
        coldStart,
        environment: environment(),
      };
      post({ id, type: 'done', report });
    }
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<BenchRequest>) => {
  void handle(event.data);
};
