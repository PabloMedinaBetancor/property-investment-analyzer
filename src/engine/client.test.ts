import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEngine, parseEnvelope, type Engine } from './abi';
import {
  createEngineClient,
  EngineError,
  type EngineChannel,
  type EngineReply,
  type EngineRequest,
} from './client';
import type { Inputs } from './types';

const f1 = (
  JSON.parse(readFileSync(resolve('tests/fixtures', 'proforma_F1.json'), 'utf8')) as {
    inputs: Inputs;
  }
).inputs;
const f2 = (
  JSON.parse(readFileSync(resolve('tests/fixtures', 'proforma_F2.json'), 'utf8')) as {
    inputs: Inputs;
  }
).inputs;

function withField(root: Inputs, key: keyof Inputs, value: unknown): unknown {
  return { ...root, [key]: value };
}

let engine: Engine;

beforeAll(async () => {
  engine = await loadEngine(readFileSync(resolve('src/engine/invest_engine.wasm')));
});

// Holds requests until the test answers them, the way a worker answers them one after another.
function manualChannel() {
  const queue: EngineRequest[] = [];
  const channel: EngineChannel = {
    postMessage: (request) => queue.push(request),
    onmessage: null,
    onerror: null,
  };
  const answerAll = () => {
    for (const { id, op, payload } of queue.splice(0)) {
      const envelope = parseEnvelope(engine.run(op, JSON.stringify(payload)));
      channel.onmessage?.({ data: { id, ...envelope } } as MessageEvent<EngineReply>);
    }
  };
  return { channel, answerAll };
}

describe('the engine client', () => {
  it('analyses an emptied loan field when there is no loan', async () => {
    const { channel, answerAll } = manualChannel();
    const client = createEngineClient(channel);
    const noLoan = {
      ...f1,
      ltv: 0,
      loan: { kind: 'fixed', fixed_rate: Number.NaN, term_years: 25 },
    };
    const pending = client.analyze(noLoan as Inputs);
    answerAll();
    const analysis = await pending;
    expect(analysis.acquisition.loan).toBe(0);
  });

  it('resolves an analysis with the value the engine returns', async () => {
    const { channel, answerAll } = manualChannel();
    const client = createEngineClient(channel);
    const pending = client.analyze(f1);
    answerAll();
    const expected = parseEnvelope(engine.run('analyze', JSON.stringify(f1)));
    expect(await pending).toEqual(expected.ok ? expected.value : null);
  });

  it('rejects a superseded request and drops its late reply', async () => {
    const { channel, answerAll } = manualChannel();
    const client = createEngineClient(channel);
    const first = client.analyze(f1);
    const second = client.analyze(f2);
    await expect(first).rejects.toMatchObject({ code: 'superseded' });
    answerAll();
    const expected = parseEnvelope(engine.run('analyze', JSON.stringify(f2)));
    expect(await second).toEqual(expected.ok ? expected.value : null);
  });

  it('keeps one pending request per op, so analyze and sensitivity do not supersede each other', async () => {
    const { channel, answerAll } = manualChannel();
    const client = createEngineClient(channel);
    const analysis = client.analyze(f1);
    const tornado = client.sensitivity(f1);
    answerAll();
    expect(await analysis).toHaveProperty('metrics');
    expect(await tornado).toHaveProperty('bars');
  });

  it('rejects with the engine code and field of an invalid input', async () => {
    const { channel, answerAll } = manualChannel();
    const client = createEngineClient(channel);
    const pending = client.analyze(withField(f1, 'price', undefined) as Inputs);
    answerAll();
    await expect(pending).rejects.toBeInstanceOf(EngineError);
    await expect(pending).rejects.toMatchObject({ code: 'missing_field', field: 'price' });
  });

  it('rejects everything pending with worker_failed when the worker errors', async () => {
    const { channel } = manualChannel();
    const client = createEngineClient(channel);
    const pending = client.sensitivity(f1);
    channel.onerror?.({ message: 'the worker stopped' } as ErrorEvent);
    await expect(pending).rejects.toMatchObject({
      code: 'worker_failed',
      message: 'the worker stopped',
    });
  });

  it('fails new calls at once with worker_failed after the worker has errored, without posting them', async () => {
    const { channel } = manualChannel();
    const posted = vi.spyOn(channel, 'postMessage');
    const client = createEngineClient(channel);
    channel.onerror?.({ message: 'the worker stopped' } as ErrorEvent);
    await expect(client.analyze(f1)).rejects.toMatchObject({
      code: 'worker_failed',
      message: 'the worker stopped',
    });
    expect(posted).not.toHaveBeenCalled();
  });
});
