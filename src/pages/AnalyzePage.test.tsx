import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '../engine/client';
import type { Inputs } from '../engine/types';
import { LocaleProvider } from '../i18n';
import type { Locale } from '../i18n';
import { defaultMc } from '../model/defaults';
import { examples } from '../model/examples';
import { listScenarios } from '../model/storage';
import { decode, encode } from '../model/urlState';
import { fakeEngine } from '../test-engine';
import type { FakeEngine } from '../test-engine';
import { AnalyzePage } from './AnalyzePage';

function page(locale: Locale = 'en', engine: FakeEngine = fakeEngine()) {
  render(
    <LocaleProvider initial={locale}>
      <AnalyzePage engine={engine} />
    </LocaleProvider>,
  );
  return { engine, user: userEvent.setup() };
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('AnalyzePage', () => {
  it('shows the summary of the Madrid example: net yield 4.27 %', async () => {
    page();
    expect(await screen.findByText('Net yield')).toBeInTheDocument();
    expect(screen.getByText(/4\.27\s%/)).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase price')).toHaveValue('180,000');
  });

  it('draws the cash flow chart under its tab', async () => {
    const { user } = page();
    await user.click(await screen.findByRole('tab', { name: 'Cash flow' }));
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
  });

  it('draws the three risk charts once the simulation has answered', async () => {
    const { user, engine } = page();
    await user.click(await screen.findByRole('tab', { name: 'Risk' }));
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3);
    });
    expect(engine.simulate).toHaveBeenCalled();
  });

  it('draws the tornado chart under Sensitivity', async () => {
    const { user } = page();
    await user.click(await screen.findByRole('tab', { name: 'Sensitivity' }));
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(1);
    });
  });

  it('opens the scenario of a link in the address', async () => {
    const madrid = examples[0]?.inputs;
    const valencia = examples[1]?.inputs;
    if (!madrid || !valencia) throw new Error('examples missing');
    window.history.replaceState(null, '', `#/?s=${encode(valencia)}`);
    page();
    expect(screen.getByLabelText('Purchase price')).toHaveValue('260,000');
    expect(await screen.findByText('Net yield')).toBeInTheDocument();
  });

  it('a broken link shows the notice and the default example', () => {
    window.history.replaceState(null, '', '#/?s=2.nonsense');
    page();
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase price')).toHaveValue('180,000');
  });

  it('writes the scenario into the address 500 ms after an edit, without a new history entry', async () => {
    const { user } = page();
    const before = window.history.length;
    const field = screen.getByLabelText('Purchase price');
    await user.clear(field);
    await user.type(field, '201000');
    await waitFor(
      () => {
        const text = new URLSearchParams(window.location.hash.split('?')[1]).get('s');
        const decoded = decode(text ?? '');
        expect('inputs' in decoded && decoded.inputs.price).toBe(201000);
      },
      { timeout: 2000 },
    );
    expect(window.history.length).toBe(before);
  });

  it('does not call the engine for a price the form refuses, and says why', async () => {
    const { user, engine } = page();
    await screen.findByText('Net yield');
    const calls = engine.analyze.mock.calls.length;
    const field = screen.getByLabelText('Purchase price');
    await user.clear(field);
    await user.type(field, '-1');
    expect(screen.getByText('Fix the marked fields to update the results.')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(engine.analyze.mock.calls.length).toBe(calls);
  });

  it('saves a scenario, lists it and loads it back', async () => {
    const { user } = page();
    await user.clear(screen.getByLabelText('Name (optional)'));
    await user.type(screen.getByLabelText('Name (optional)'), 'My flat');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(listScenarios().map((s) => s.name)).toEqual(['My flat']);
    const price = screen.getByLabelText('Purchase price');
    await user.clear(price);
    await user.type(price, '99000');
    await user.selectOptions(screen.getByLabelText('Saved scenarios'), 'My flat');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(screen.getByLabelText('Purchase price')).toHaveValue('180,000');
  });

  it('says the scenario was saved, and clears the message when the inputs change', async () => {
    const { user } = page();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Scenario saved.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Purchase price'), '1');
    expect(screen.queryByText('Scenario saved.')).toBeNull();
  });

  it('does not save or copy a scenario with a field the form refuses', async () => {
    const { user } = page();
    await user.clear(screen.getByLabelText('Purchase price'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Fix the marked fields first.')).toBeInTheDocument();
    expect(listScenarios()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByText('Fix the marked fields first.')).toBeInTheDocument();
  });

  it('loads an example from the menu', async () => {
    const { user } = page();
    await user.selectOptions(screen.getByLabelText('Load an example'), 'valencia');
    expect(screen.getByLabelText('Purchase price')).toHaveValue('260,000');
  });

  it('the compare link carries the current scenario as A', () => {
    page();
    const link = screen.getByRole('link', { name: 'Compare' });
    const a = new URLSearchParams(link.getAttribute('href')?.split('?')[1]).get('a');
    expect(decode(a ?? '')).toEqual({
      inputs: { ...examples[0]?.inputs, name: 'Resale flat, Madrid' },
    });
  });

  it('asks for the simulation on request above 10 000 scenarios, from the Risk tab', async () => {
    const { user, engine } = page();
    await screen.findByText('Net yield');
    await user.click(screen.getByText('Simulation'));
    const n = screen.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, '50000');
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    const run = await screen.findByRole('button', { name: /Run simulation/ });
    const calls = engine.simulate.mock.calls.length;
    await user.click(run);
    await waitFor(() => {
      expect(engine.simulate.mock.calls.length).toBe(calls + 1);
    });
  });

  it('labels the Run simulation button without a count while the scenario count is not a number', async () => {
    const { user } = page();
    await screen.findByText('Net yield');
    await user.click(screen.getByText('Simulation'));
    const n = screen.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, 'abc');
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    expect(await screen.findByRole('button', { name: 'Run simulation' })).toBeInTheDocument();
  });

  it('keeps the Run simulation button focusable while it calculates, and says so in a status', async () => {
    const engine = fakeEngine();
    const { user } = page('en', engine);
    await screen.findByText('Net yield');
    await user.click(screen.getByText('Simulation'));
    const n = screen.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, '50000');
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    engine.simulate.mockReturnValue(new Promise(() => undefined));
    const run = await screen.findByRole('button', { name: /Run simulation/ });
    await user.click(run);
    await waitFor(() => {
      expect(run).toHaveAttribute('aria-disabled', 'true');
    });
    expect(run).not.toBeDisabled();
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain(
      'Calculating…',
    );
  });

  it('shows the disclaimer with the rates date and the source link', () => {
    page();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(/Not financial or tax advice/)).toBeInTheDocument();
    expect(within(footer).getByText(/rates as of 16 Oct 2026\./)).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Source code' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Third-party licences' })).toHaveAttribute(
      'href',
      './THIRD-PARTY-LICENSES.txt',
    );
  });

  it('says in Spanish which field the engine refused, and keeps the previous results dimmed under a sentence', async () => {
    const engine = fakeEngine();
    const { user } = page('es', engine);
    await screen.findByText('Rentabilidad neta');
    engine.analyze.mockRejectedValue(
      new EngineError('out_of_range', 'loan.fixed_rate', 'must be between 0 and 0.3, got -0.005'),
    );
    const price = screen.getByLabelText('Precio de compra');
    await user.clear(price);
    await user.type(price, '170000');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '«Tipo de interés fijo» está fuera del rango que admite el cálculo.',
    );
    expect(alert).not.toHaveTextContent('must be between');
    expect(
      screen.getByText('Los resultados de abajo son de datos anteriores.'),
    ).toBeInTheDocument();
  });

  it('shows a sensitivity failure in the Sensitivity tab only, not above the valid analysis', async () => {
    const engine = fakeEngine();
    engine.sensitivity.mockRejectedValue(new EngineError('worker_failed', '', 'trap'));
    const { user } = page('en', engine);
    await screen.findByText('Net yield');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Sensitivity' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calculation could not run; reload the page.',
    );
  });

  it('says in the Risk tab that the simulation answers earlier settings or inputs until it is run again', async () => {
    const { user } = page();
    await screen.findByText('Net yield');
    await user.click(screen.getByText('Simulation'));
    const n = screen.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, '50000');
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    const earlier = 'These results are for earlier inputs; run the simulation again.';
    expect(await screen.findByText(earlier)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Run simulation/ }));
    await waitFor(() => {
      expect(screen.queryByText(earlier)).toBeNull();
    });
    const price = screen.getByLabelText('Purchase price');
    await user.clear(price);
    await user.type(price, '170000');
    expect(await screen.findByText(earlier)).toBeInTheDocument();
  });

  it('opens a link that carries the simulation settings, and runs the simulation with them', async () => {
    const madrid = examples[0]?.inputs as Inputs;
    window.history.replaceState(null, '', `#/?s=${encode(madrid, { ...defaultMc, seed: 7 })}`);
    const { user, engine } = page();
    await user.click(screen.getByText('Simulation'));
    expect(screen.getByLabelText('Random seed')).toHaveValue('7');
    await waitFor(() => {
      expect(engine.simulate).toHaveBeenCalledWith(madrid, defaultMc.params, 10000, 7);
    });
  });

  it('writes a changed seed into the address and into the compare link', async () => {
    const { user } = page();
    await user.click(screen.getByText('Simulation'));
    const seed = screen.getByLabelText('Random seed');
    await user.clear(seed);
    await user.type(seed, '99');
    await waitFor(
      () => {
        const text = new URLSearchParams(window.location.hash.split('?')[1]).get('s');
        const decoded = decode(text ?? '');
        expect('mc' in decoded && decoded.mc?.seed).toBe(99);
      },
      { timeout: 2000 },
    );
    const href = screen.getByRole('link', { name: 'Compare' }).getAttribute('href');
    const a = decode(new URLSearchParams(href?.split('?')[1]).get('a') ?? '');
    expect('mc' in a && a.mc?.seed).toBe(99);
  });
});
