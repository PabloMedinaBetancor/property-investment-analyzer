import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenchEvent, BenchReport } from '../bench/protocol';
import { LocaleProvider } from '../i18n';
import { BenchmarkPage } from './BenchmarkPage';

const timing = (median: number) => ({
  median,
  min: median - 1,
  p90: median + 2,
  scenariosPerSecond: 1000 / (median / 1000),
  samples: [],
  checksum: 12.5,
});

const report: BenchReport = {
  n: 1000,
  years: 10,
  seed: 42,
  wasm: timing(8),
  js: timing(12),
  ratio: 1.5,
  coldStart: { wasmMs: 20, jsMs: 5 },
  environment: {
    userAgent: 'TestBrowser',
    hardwareConcurrency: 4,
    deviceMemory: null,
    date: '2026-10-16',
  },
};

class FakeWorker {
  static last: FakeWorker | undefined;
  onmessage: ((event: MessageEvent<BenchEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(event: BenchEvent) {
    act(() => {
      this.onmessage?.({ data: event } as MessageEvent<BenchEvent>);
    });
  }
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = () =>
  render(
    <LocaleProvider initial="en">
      <BenchmarkPage />
    </LocaleProvider>,
  );

describe('BenchmarkPage', () => {
  it('asks the worker for 1 000 scenarios over 10 years and shows both columns after «parity passed»', () => {
    open();
    fireEvent.change(screen.getByLabelText('Scenarios'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const worker = FakeWorker.last;
    expect(worker?.posted[0]).toMatchObject({ n: 1000, seed: 42, inputs: { years: 10 } });
    worker?.emit({ id: 1, type: 'parity', parity: { ok: true, worst: 3e-12, mismatches: [] } });
    expect(screen.getByText(/Parity passed/)).toBeInTheDocument();
    worker?.emit({ id: 1, type: 'done', report });
    expect(screen.getByRole('row', { name: /Rust \/ WebAssembly/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /TypeScript/ })).toBeInTheDocument();
    expect(screen.getByText(/1\.50 times/)).toBeInTheDocument();
    expect(worker?.terminated).toBe(true);
  });

  it('shows «parity failed» with the fields and no times', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    FakeWorker.last?.emit({
      id: 1,
      type: 'parity',
      parity: { ok: false, worst: 1e-6, mismatches: ['npv_p[0]'] },
    });
    expect(screen.getByText(/Parity failed on npv_p\[0\]/)).toBeInTheDocument();
    expect(screen.queryByText('Results')).not.toBeInTheDocument();
  });

  it('keeps the keyboard focus on the Run button while it runs and ignores a second press', () => {
    open();
    const run = screen.getByRole('button', { name: 'Run' });
    run.focus();
    fireEvent.click(run);
    const worker = FakeWorker.last;
    const running = screen.getByRole('button', { name: 'Running' });
    expect(running).toHaveAttribute('aria-disabled', 'true');
    expect(running).not.toBeDisabled();
    expect(running).toHaveFocus();
    fireEvent.click(running);
    expect(FakeWorker.last).toBe(worker);
    expect(worker?.terminated).toBe(false);
    worker?.emit({ id: 1, type: 'done', report });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
  });

  it('says in the page language that the benchmark stopped, and keeps the raw reason for the console', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <LocaleProvider initial="es">
        <BenchmarkPage />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    FakeWorker.last?.emit({ id: 1, type: 'error', message: 'Failed to fetch' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('La prueba se detuvo');
    expect(alert).not.toHaveTextContent('Failed to fetch');
    expect(logged).toHaveBeenCalledWith('benchmark failed:', 'Failed to fetch');
    logged.mockRestore();
  });
});
