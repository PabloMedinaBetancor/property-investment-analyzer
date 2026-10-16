import type { Op } from './abi';
import { forEngine } from '../model/engineInputs';
import type { Analysis, ErrorCode, Inputs, McParams, McResult, Sensitivity } from './types';

// `superseded`: a newer request of the same op replaced this one. `worker_failed`: the engine worker threw.
export type ClientErrorCode = ErrorCode | 'superseded' | 'worker_failed';

export class EngineError extends Error {
  readonly code: ClientErrorCode;
  readonly field: string;

  constructor(code: ClientErrorCode, field: string, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.field = field;
  }
}

export interface EngineRequest {
  id: number;
  op: Op;
  payload: unknown;
}

export type EngineReply = { id: number } & (
  | { ok: true; value: unknown }
  | { ok: false; error: { code: ClientErrorCode; field: string; message: string } }
);

// The part of a module Worker that the client uses; a test can stand in for it.
export interface EngineChannel {
  postMessage(request: EngineRequest): void;
  onmessage: ((event: MessageEvent<EngineReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface EngineClient {
  analyze(inputs: Inputs): Promise<Analysis>;
  simulate(inputs: Inputs, params: McParams, n: number, seed: number): Promise<McResult>;
  sensitivity(inputs: Inputs): Promise<Sensitivity>;
}

interface Waiter {
  op: Op;
  resolve(value: unknown): void;
  reject(error: EngineError): void;
}

export function createEngineClient(channel: EngineChannel): EngineClient {
  const waiting = new Map<number, Waiter>();
  let nextId = 1;
  // The text of the worker's error once it has died: nothing answers any more, so new calls fail at once.
  let died: string | null = null;

  function call<T>(op: Op, payload: unknown): Promise<T> {
    if (died !== null) return Promise.reject(new EngineError('worker_failed', '', died));
    // Only the newest request of an op is wanted: the UI drops superseded results anyway.
    for (const [id, waiter] of waiting) {
      if (waiter.op !== op) continue;
      waiting.delete(id);
      waiter.reject(new EngineError('superseded', '', `a newer ${op} request replaced this one`));
    }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, {
        op,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
      });
      channel.postMessage({ id, op, payload });
    });
  }

  channel.onmessage = (event) => {
    const reply = event.data;
    const waiter = waiting.get(reply.id);
    if (waiter === undefined) return;
    waiting.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new EngineError(reply.error.code, reply.error.field, reply.error.message));
  };

  channel.onerror = (event) => {
    died = event.message;
    for (const [id, waiter] of waiting) {
      waiting.delete(id);
      waiter.reject(new EngineError('worker_failed', '', event.message));
    }
  };

  return {
    analyze: (inputs) => call<Analysis>('analyze', forEngine(inputs)),
    simulate: (inputs, params, n, seed) =>
      call<McResult>('simulate', { inputs: forEngine(inputs), params, n, seed }),
    sensitivity: (inputs) => call<Sensitivity>('sensitivity', { inputs: forEngine(inputs) }),
  };
}

export function startEngine(): EngineClient {
  return createEngineClient(
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  );
}
