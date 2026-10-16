import type { EngineErrorInfo } from './types';

export type Op = 'analyze' | 'simulate' | 'sensitivity';

export type Envelope = { ok: true; value: unknown } | { ok: false; error: EngineErrorInfo };

// The envelope text exactly as the wasm wrote it, before JSON.parse.
export interface Engine {
  run(op: Op, json: string): string;
}

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  free_result(ptr: number, len: number): void;
  analyze(ptr: number, len: number): bigint;
  simulate(ptr: number, len: number): bigint;
  sensitivity(ptr: number, len: number): bigint;
}

const LOW_32_BITS = 0xffff_ffffn;

export async function loadEngine(bytes: BufferSource): Promise<Engine> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports as unknown as WasmExports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    run(op, json) {
      const input = encoder.encode(json);
      const inputPtr = wasm.alloc(input.length);
      new Uint8Array(wasm.memory.buffer, inputPtr, input.length).set(input);
      const packed = BigInt.asUintN(64, wasm[op](inputPtr, input.length));
      wasm.dealloc(inputPtr, input.length);
      // The result is packed as (pointer << 32) | length; a call may have grown the memory, so the view is taken now.
      const outPtr = Number(packed >> 32n);
      const outLen = Number(packed & LOW_32_BITS);
      const text = decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen));
      wasm.free_result(outPtr, outLen);
      return text;
    },
  };
}

export function parseEnvelope(text: string): Envelope {
  return JSON.parse(text) as Envelope;
}
