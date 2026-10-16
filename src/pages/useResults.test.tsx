import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McSettings } from '../components/form/Simulation';
import { EngineError } from '../engine/client';
import type { Analysis, Inputs } from '../engine/types';
import { defaultMc } from '../model/defaults';
import { examples } from '../model/examples';
import { f1Analysis, fakeEngine } from '../test-engine';
import { useResults } from './useResults';

const madrid = examples[0]?.inputs as Inputs;

interface Props {
  inputs: Inputs;
  mc: McSettings;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(engine = fakeEngine(), first: Partial<Props> = {}) {
  const hook = renderHook(({ inputs, mc }: Props) => useResults(engine, inputs, mc), {
    initialProps: { inputs: madrid, mc: defaultMc, ...first },
  });
  return { engine, hook };
}

describe('useResults', () => {
  it('calls the engine once, 300 ms after the last of several edits', async () => {
    const { engine, hook } = setup();
    for (const price of [181000, 182000, 183000]) {
      hook.rerender({ inputs: { ...madrid, price }, mc: defaultMc });
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(engine.analyze).not.toHaveBeenCalledWith(expect.objectContaining({ price: 183000 }));
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(engine.analyze).toHaveBeenCalledTimes(2);
    expect(engine.analyze).toHaveBeenLastCalledWith(expect.objectContaining({ price: 183000 }));
    expect(hook.result.current.analysis).toEqual(f1Analysis);
  });

  it('drops a reply that arrives after a newer edit', async () => {
    const slow = deferred<Analysis>();
    const fresh = { ...f1Analysis, flows: [1, 2, 3] };
    const engine = fakeEngine();
    engine.analyze = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(fresh);
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    hook.rerender({ inputs: { ...madrid, price: 190000 }, mc: defaultMc });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.analysis?.flows).toEqual([1, 2, 3]);
    await act(async () => {
      slow.resolve(f1Analysis);
      await slow.promise;
    });
    expect(hook.result.current.analysis?.flows).toEqual([1, 2, 3]);
  });

  it('does not show a superseded rejection and shows any other engine error', async () => {
    const engine = fakeEngine();
    engine.analyze = vi
      .fn()
      .mockRejectedValueOnce(new EngineError('superseded', '', 'replaced'))
      .mockRejectedValueOnce(new EngineError('out_of_range', 'price', 'price must be above 0'));
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.analysis).toBeNull();
    hook.rerender({ inputs: { ...madrid, price: 1 }, mc: defaultMc });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.analysis).toEqual({ code: 'out_of_range', field: 'price' });
  });

  it('keeps the failure of each operation apart: a sensitivity failure is not an analysis failure', async () => {
    const engine = fakeEngine();
    engine.sensitivity = vi
      .fn()
      .mockRejectedValue(new EngineError('out_of_range', 'loan.fixed_rate', 'got -0.01'));
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors).toEqual({
      analysis: null,
      sensitivity: { code: 'out_of_range', field: 'loan.fixed_rate' },
      simulation: null,
    });
    expect(hook.result.current.analysis).toEqual(f1Analysis);
  });

  it('stops calculating when the simulation fails', async () => {
    const engine = fakeEngine();
    engine.simulate = vi.fn().mockRejectedValue(new EngineError('worker_failed', '', 'trap'));
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.simulation).toEqual({ code: 'worker_failed', field: '' });
    expect(hook.result.current.simulating).toBe(false);
  });

  it('does not call the engine while the inputs are invalid', async () => {
    const { engine } = setup(fakeEngine(), { inputs: { ...madrid, price: Number.NaN } });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(engine.analyze).not.toHaveBeenCalled();
    expect(engine.simulate).not.toHaveBeenCalled();
  });

  it('simulates by itself up to 10 000 scenarios', async () => {
    const { engine, hook } = setup();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(engine.simulate).toHaveBeenCalledWith(madrid, defaultMc.params, 10000, 42);
    expect(hook.result.current.auto).toBe(true);
    expect(hook.result.current.simulating).toBe(false);
  });

  it('above 10 000 scenarios simulates only on request, and again after each request', async () => {
    const big = { ...defaultMc, n: 20000 };
    const { engine, hook } = setup(fakeEngine(), { mc: big });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.auto).toBe(false);
    expect(engine.simulate).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.runSimulation();
    });
    await flush();
    expect(engine.simulate).toHaveBeenCalledTimes(1);
    expect(engine.simulate).toHaveBeenCalledWith(madrid, big.params, 20000, 42);
    hook.rerender({ inputs: { ...madrid, price: 170000 }, mc: big });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(engine.simulate).toHaveBeenCalledTimes(1);
  });

  it('marks the shown simulation as stale after an edit above 10 000 scenarios, until it is run again', async () => {
    const big = { ...defaultMc, n: 20000 };
    const { hook } = setup(fakeEngine(), { mc: big });
    act(() => {
      hook.result.current.runSimulation();
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.simulationStale).toBe(false);
    hook.rerender({ inputs: { ...madrid, price: 170000 }, mc: big });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.simulationStale).toBe(true);
    expect(hook.result.current.simulating).toBe(false);
    act(() => {
      hook.result.current.runSimulation();
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.simulationStale).toBe(false);
  });

  it('never sends the invalid inputs to the engine while recovering from them', async () => {
    const engine = fakeEngine();
    const withPrice = (price: number) => {
      const inputs = { ...madrid, price };
      return { inputs, mc: defaultMc };
    };
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    hook.rerender(withPrice(Number.NaN));
    await act(() => vi.advanceTimersByTimeAsync(600));
    hook.rerender(withPrice(1));
    await flush();
    for (const call of [...engine.analyze.mock.calls, ...engine.simulate.mock.calls]) {
      expect(Number.isNaN(call[0].price)).toBe(false);
    }
    expect(hook.result.current.errors.analysis).toBeNull();
  });

  it('drops an earlier engine failure once the settled inputs are invalid', async () => {
    const engine = fakeEngine();
    engine.analyze = vi
      .fn()
      .mockRejectedValue(new EngineError('out_of_range', 'price', 'price must be above 0'));
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.analysis).toEqual({ code: 'out_of_range', field: 'price' });
    hook.rerender({ inputs: { ...madrid, price: Number.NaN }, mc: defaultMc });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.analysis).toBeNull();
  });

  it('drops a simulation failure once the settings no longer ask for that run', async () => {
    const engine = fakeEngine();
    engine.simulate = vi.fn().mockRejectedValue(new EngineError('worker_failed', '', 'trap'));
    const { hook } = setup(engine);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.simulation).toEqual({ code: 'worker_failed', field: '' });
    hook.rerender({ inputs: madrid, mc: { ...defaultMc, n: 25000 } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.errors.simulation).toBeNull();
  });
});
