import { describe, expect, it, vi } from 'vitest';
import type { Engine } from './abi';
import { createAnswerer } from './answerer';
import type { EngineRequest } from './client';

const request: EngineRequest = { id: 7, op: 'analyze', payload: { price: 1 } };
const ok = '{"ok":true,"value":{"npv":-5533}}';

const engineAnswering = (text: string): Engine => ({ run: () => text });
const engineTrapping = (): Engine => ({
  run: () => {
    throw new Error('unreachable');
  },
});

describe('the engine answerer', () => {
  it('answers with the envelope the engine wrote, under the request id', async () => {
    const answer = createAnswerer(() => Promise.resolve(engineAnswering(ok)));
    expect(await answer(request)).toEqual({ id: 7, ok: true, value: { npv: -5533 } });
  });

  it('replies worker_failed after a trap and answers the next request with a fresh instance', async () => {
    const instances = [engineTrapping(), engineAnswering(ok)];
    const instantiate = vi.fn(() => Promise.resolve(instances.shift() ?? engineTrapping()));
    const answer = createAnswerer(instantiate);
    expect(await answer(request)).toMatchObject({
      id: 7,
      ok: false,
      error: { code: 'worker_failed', message: 'Error: unreachable' },
    });
    expect(await answer({ ...request, id: 8 })).toEqual({ id: 8, ok: true, value: { npv: -5533 } });
    expect(instantiate).toHaveBeenCalledTimes(2);
  });

  it('tries to load again after a load failure, such as a 404 on the wasm file', async () => {
    const instantiate = vi
      .fn<() => Promise<Engine>>()
      .mockRejectedValueOnce(new Error('the engine file did not load: HTTP 404'))
      .mockResolvedValue(engineAnswering(ok));
    const answer = createAnswerer(instantiate);
    expect(await answer(request)).toMatchObject({
      ok: false,
      error: { code: 'worker_failed', message: 'Error: the engine file did not load: HTTP 404' },
    });
    expect(await answer({ ...request, id: 8 })).toMatchObject({ id: 8, ok: true });
  });
});
