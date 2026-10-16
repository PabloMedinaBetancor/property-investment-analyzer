import { loadEngine } from './abi';
import { createAnswerer } from './answerer';
import type { EngineRequest } from './client';

const wasm = new URL('./invest_engine.wasm', import.meta.url);

async function instantiate() {
  const response = await fetch(wasm);
  if (!response.ok)
    throw new Error(`the engine file did not load: HTTP ${response.status.toString()}`);
  return loadEngine(await response.arrayBuffer());
}

const answer = createAnswerer(instantiate);

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  void answer(event.data).then((reply) => {
    self.postMessage(reply);
  });
};
