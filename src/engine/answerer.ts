import { parseEnvelope } from './abi';
import type { Engine } from './abi';
import type { EngineReply, EngineRequest } from './client';

// Loading starts at once, so the first request does not wait for it. After any exception the next request gets a
// fresh instance: a trap can leave the heap and the simulator's borrow flag half-way through an operation.
export function createAnswerer(instantiate: () => Promise<Engine>) {
  const start = () => {
    const loading = instantiate();
    // Reported with the first request that needs the engine, not as an unhandled rejection.
    loading.catch(() => undefined);
    return loading;
  };
  let engine = start();

  return async ({ id, op, payload }: EngineRequest): Promise<EngineReply> => {
    try {
      return { id, ...parseEnvelope((await engine).run(op, JSON.stringify(payload))) };
    } catch (error) {
      engine = start();
      return { id, ok: false, error: { code: 'worker_failed', field: '', message: String(error) } };
    }
  };
}
