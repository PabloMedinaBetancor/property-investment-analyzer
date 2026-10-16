import { readFileSync } from 'node:fs';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, Inputs, McResult } from '../engine/types';
import { createEngineClient, EngineError } from '../engine/client';
import type { EngineChannel, EngineClient, EngineReply, EngineRequest } from '../engine/client';
import { LocaleProvider } from '../i18n';
import { defaultMc } from '../model/defaults';
import { examples } from '../model/examples';
import { decode, encode } from '../model/urlState';
import { ComparePage } from './ComparePage';

interface Proforma {
  inputs: Inputs;
  result: Analysis;
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
}

const f1 = fixture('proforma_F1') as Proforma;
const f2 = fixture('proforma_F2') as Proforma;
const mc = fixture('monte_carlo_F1_n2000_seed42') as McResult;

const calls: Inputs[] = [];
const simulations: number[] = [];

// Answers each scenario with the fixture whose price it carries: the engine itself is tested elsewhere.
const client: EngineClient = {
  analyze: (inputs) => {
    calls.push(inputs);
    return Promise.resolve(inputs.price === f1.inputs.price ? f1.result : f2.result);
  },
  simulate: (_inputs, _params, n) => {
    simulations.push(n);
    return Promise.resolve(mc);
  },
  sensitivity: () => Promise.reject(new Error('not used by the comparison')),
};

function show(hash = '#/compare', engine: EngineClient = client) {
  window.location.hash = hash;
  return render(
    <LocaleProvider initial="en">
      <ComparePage client={engine} />
    </LocaleProvider>,
  );
}

const madrid = examples[0]?.inputs;
const valencia = examples[1]?.inputs;

beforeEach(() => {
  calls.length = 0;
  simulations.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ComparePage', () => {
  it('shows the Madrid and Valencia examples with the fixtures NPVs of -5,533 and -8,588 in their columns', async () => {
    show();
    const row = (await screen.findByRole('rowheader', { name: 'NPV' })).closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('-€5,533');
    expect(cells[1]).toHaveTextContent('-€8,588');
    expect(cells[2]).toHaveTextContent('-€3,055');
  });

  it('marks the better side with the word «better»: Madrid has the higher NPV', async () => {
    show();
    const row = (await screen.findByRole('rowheader', { name: 'NPV' })).closest('tr');
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(within(cells[0] as HTMLElement).getByText('better')).toBeInTheDocument();
    expect(within(cells[1] as HTMLElement).queryByText('better')).toBeNull();
  });

  it('reads the a and b links, and writes them back after the edit delay', async () => {
    if (!madrid || !valencia) throw new Error('examples missing');
    const swapped = { ...valencia, price: valencia.price };
    show(`#/compare?a=${encode(swapped)}&b=${encode(madrid)}`);
    await screen.findByRole('rowheader', { name: 'NPV' });
    expect(calls[0]).toEqual(swapped);
    expect(calls[1]).toEqual(madrid);
    await waitFor(
      () => {
        const query = new URLSearchParams(window.location.hash.split('?')[1]);
        const a = decode(query.get('a') ?? '');
        const b = decode(query.get('b') ?? '');
        expect(a).toEqual({ inputs: swapped });
        expect(b).toEqual({ inputs: madrid });
      },
      { timeout: 2000 },
    );
  });

  it('says so when a link cannot be read, and shows the examples', async () => {
    show('#/compare?a=9.broken');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This link could not be read; showing the default examples.',
    );
    await screen.findByRole('rowheader', { name: 'NPV' });
    expect(calls[0]).toEqual({ ...madrid, name: 'Resale flat, Madrid' });
  });

  it('loads an example into scenario B from the picker', async () => {
    show();
    await screen.findByRole('rowheader', { name: 'NPV' });
    const before = calls.length;
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('Load into scenario B'), 'example:madrid');
    await waitFor(() => {
      expect(calls.length).toBe(before + 2);
    });
    expect(calls.at(-1)).toEqual({ ...madrid, name: 'Resale flat, Madrid' });
  });

  it('shows the P10, P50 and P90 of the NPV and the chance of a loss for both', async () => {
    show();
    const risk = await screen.findByRole('columnheader', { name: 'P10' });
    const body = within(risk.closest('table') as HTMLElement).getAllByRole('row')[1];
    expect(body).toHaveTextContent('-€24,415');
    expect(body).toHaveTextContent('67.9 %');
  });
});

describe('ComparePage when the address changes under it', () => {
  const priced = (price: number) => ({ ...(madrid as Inputs), price });
  const link = (first: Inputs, second: Inputs) =>
    `#/compare?a=${encode(first)}&b=${encode(second)}`;

  it('reads a link followed or pasted while the page is open', async () => {
    show(link(priced(150000), priced(250000)));
    await screen.findByRole('rowheader', { name: 'NPV' });
    expect(calls.map((inputs) => inputs.price)).toContain(150000);
    calls.length = 0;
    act(() => {
      window.location.hash = link(priced(111000), priced(222000));
    });
    await waitFor(() => {
      expect(calls.map((inputs) => inputs.price)).toEqual([111000, 222000]);
    });
  });

  it('writes the address back when the Compare link drops the scenarios, keeping what is shown', async () => {
    show(link(priced(150000), priced(250000)));
    await screen.findByRole('rowheader', { name: 'NPV' });
    // Past the delay after which the page writes its own address, so only the nav link can have changed it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    calls.length = 0;
    act(() => {
      window.location.hash = '#/compare';
    });
    await waitFor(() => {
      const query = new URLSearchParams(window.location.hash.split('?')[1]);
      expect(decode(query.get('a') ?? '')).toEqual({ inputs: priced(150000) });
      expect(decode(query.get('b') ?? '')).toEqual({ inputs: priced(250000) });
    });
    expect(calls).toHaveLength(0);
  });
});

describe('ComparePage simulation settings in the link', () => {
  it('reads seed 7 from the a payload, simulates both scenarios with it, and writes it back', async () => {
    if (!madrid || !valencia) throw new Error('examples missing');
    const seeds: number[] = [];
    const seeded: EngineClient = {
      ...client,
      simulate: (_inputs, _params, _n, seed) => {
        seeds.push(seed);
        return Promise.resolve(mc);
      },
    };
    show(`#/compare?a=${encode(madrid, { ...defaultMc, seed: 7 })}&b=${encode(valencia)}`, seeded);
    await screen.findByRole('columnheader', { name: 'P10' });
    expect(seeds).toEqual([7, 7]);
    await waitFor(
      () => {
        const query = new URLSearchParams(window.location.hash.split('?')[1]);
        const a = decode(query.get('a') ?? '');
        expect('mc' in a && a.mc?.seed).toBe(7);
      },
      { timeout: 2000 },
    );
  });
});

describe('ComparePage gates, as on the Analyze page', () => {
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  it('does not call the engine for a half-typed price, and says to fix the field', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('rowheader', { name: 'NPV' });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    await user.clear(within(screen.getByRole('dialog')).getByLabelText('Purchase price'));
    await pause(450);
    expect(calls.filter((inputs) => !Number.isFinite(inputs.price))).toHaveLength(0);
    expect(screen.getByText('Fix the marked fields to update the results.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toMatch(/engine|range/);
  });

  it('opens the section of an invalid field in the drawer', async () => {
    const user = userEvent.setup();
    const broken = { ...(madrid as Inputs), vacancy: 1 };
    show(`#/compare?a=${encode(broken)}&b=${encode(valencia as Inputs)}`);
    await screen.findAllByRole('button', { name: 'Edit' });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    const field = within(screen.getByRole('dialog')).getByLabelText('Vacancy');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.closest('details')).toHaveAttribute('open');
  });

  it('moves focus into the drawer on Edit, and Escape or Close return it to the Edit button', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('rowheader', { name: 'NPV' });
    const edit = screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement;
    await user.click(edit);
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(edit).toHaveFocus();
    await user.click(edit);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(edit).toHaveFocus();
  });

  it('runs a simulation of more than 10 000 scenarios only when asked, for both scenarios', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('columnheader', { name: 'P10' });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByText('Simulation'));
    const n = dialog.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, '50000');
    await pause(450);
    expect(simulations.filter((count) => count === 50000)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Run simulation/ }));
    await waitFor(() => {
      expect(simulations.filter((count) => count === 50000)).toHaveLength(2);
    });
  });
});

describe('ComparePage when the engine refuses a scenario', () => {
  it('writes the reason in Spanish under that scenario, with the field named as the form does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusing: EngineClient = {
      ...client,
      analyze: (inputs) =>
        inputs.price === f1.inputs.price
          ? Promise.reject(
              new EngineError('missing_field', 'rent_month', 'missing field `rent_month`'),
            )
          : client.analyze(inputs),
    };
    window.location.hash = '#/compare';
    render(
      <LocaleProvider initial="es">
        <ComparePage client={refusing} />
      </LocaleProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Falta «Renta mensual».');
  });
});

// The real client over a channel that holds the first simulation, to reproduce an edit made while it runs.
describe('ComparePage when the inputs change during a calculation', () => {
  it('ends with the results of the new inputs on both sides, not stuck on «calculating»', async () => {
    const held: EngineRequest[] = [];
    let holding = true;
    const channel: EngineChannel = {
      onmessage: null,
      onerror: null,
      postMessage: ({ id, op, payload }) => {
        if (op === 'simulate' && holding) {
          held.push({ id, op, payload });
          return;
        }
        const price =
          op === 'simulate'
            ? (payload as { inputs: Inputs }).inputs.price
            : (payload as Inputs).price;
        const value = op === 'simulate' ? mc : price === f1.inputs.price ? f1.result : f2.result;
        queueMicrotask(() =>
          channel.onmessage?.({ data: { id, ok: true, value } } as MessageEvent<EngineReply>),
        );
      },
    };
    show('#/compare', createEngineClient(channel));
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    holding = false;
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('Load into scenario B'), 'example:madrid');
    expect(
      await screen.findByRole('columnheader', { name: 'P10' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
