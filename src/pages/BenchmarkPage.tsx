import { useEffect, useRef, useState } from 'react';
import type { BenchEvent, BenchReport, ParityReport } from '../bench/protocol';
import { useFormat, useT } from '../i18n';
import { defaultMc } from '../model/defaults';
import { examples } from '../model/examples';
import { useBenchT } from './useBenchT';
import './BenchmarkPage.css';

const SIZES = [1000, 10000, 100000];
const HOLDINGS = [10, 30];
const SEED = 42;

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'finished' }
  | { kind: 'failed' };

export function BenchmarkPage() {
  const t = useT();
  const b = useBenchT();
  const f = useFormat();
  const [n, setN] = useState(10000);
  const [holding, setHolding] = useState(10);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [parity, setParity] = useState<ParityReport | null>(null);
  const [report, setReport] = useState<BenchReport | null>(null);
  const worker = useRef<Worker | null>(null);

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  useEffect(() => stop, []);

  // The reason is the browser's own text, in English: it goes to the console, and the page says it in its language.
  const fail = (message: string) => {
    console.error('benchmark failed:', message);
    setStatus({ kind: 'failed' });
    stop();
  };

  const run = () => {
    if (worker.current) return;
    stop();
    setParity(null);
    setReport(null);
    setStatus({ kind: 'running', done: 0, total: 30 });
    const next = new Worker(new URL('../bench/bench.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = next;
    next.onmessage = (message: MessageEvent<BenchEvent>) => {
      const event = message.data;
      if (event.type === 'parity') {
        setParity(event.parity);
        if (!event.parity.ok) {
          setStatus({ kind: 'finished' });
          stop();
        }
      } else if (event.type === 'progress') {
        setStatus({ kind: 'running', done: event.done, total: event.total });
      } else if (event.type === 'done') {
        setReport(event.report);
        setStatus({ kind: 'finished' });
        stop();
      } else {
        fail(event.message);
      }
    };
    next.onerror = (event) => {
      fail(event.message);
    };
    const base = examples[0]?.inputs;
    if (!base) return;
    next.postMessage({
      id: 1,
      inputs: { ...base, years: holding },
      params: defaultMc.params,
      n,
      seed: SEED,
    });
  };

  const running = status.kind === 'running';
  const download = () => {
    const blob = new Blob([JSON.stringify({ parity, report }, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'benchmark.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="bench">
      <h2>{t('nav.benchmark')}</h2>
      <p>{b('intro1')}</p>
      <p>{b('intro2')}</p>
      <p>{b('intro3')}</p>

      <div className="bench-controls">
        <label>
          {b('scenarios')}
          <select
            value={n}
            disabled={running}
            onChange={(e) => {
              setN(Number(e.target.value));
            }}
          >
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {f.number(size, 0)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {b('holding')}
          <select
            value={holding}
            disabled={running}
            onChange={(e) => {
              setHolding(Number(e.target.value));
            }}
          >
            {HOLDINGS.map((years) => (
              <option key={years} value={years}>
                {b('years', { n: years })}
              </option>
            ))}
          </select>
        </label>
        {/* aria-disabled, not disabled: a disabled button drops the keyboard focus to the page. */}
        <button type="button" className="bench-run" aria-disabled={running} onClick={run}>
          {running ? b('running') : b('run')}
        </button>
      </div>
      <p className="bench-note">{b('example')}</p>

      {status.kind === 'running' && (
        <p role="status">
          <progress value={status.done} max={status.total} />{' '}
          {b('progress', { done: status.done, total: status.total })}
        </p>
      )}
      {status.kind === 'failed' && <p role="alert">{b('error')}</p>}

      {parity && (
        <div className="bench-block">
          <h3>{b('parityTitle')}</h3>
          <p role="status" className={parity.ok ? 'bench-ok' : 'bench-bad'}>
            {parity.ok
              ? b('parityPassed', { worst: parity.worst.toExponential(1) })
              : b('parityFailed', { fields: parity.mismatches.join(', ') })}
          </p>
        </div>
      )}

      {report && (
        <>
          <div className="bench-block">
            <h3>{b('resultTitle')}</h3>
            <p className="bench-note">
              {b('sample', { n: f.number(report.n, 0), years: report.years, seed: report.seed })}
            </p>
            <div className="bench-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{b('implementation')}</th>
                    <th scope="col">{b('median')}</th>
                    <th scope="col">{b('min')}</th>
                    <th scope="col">{b('p90')}</th>
                    <th scope="col">{b('perSecond')}</th>
                    <th scope="col">{b('checksum')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(['wasm', 'js'] as const).map((name) => (
                    <tr key={name}>
                      <th scope="row">{b(name)}</th>
                      <td>{f.number(report[name].median, 1)}</td>
                      <td>{f.number(report[name].min, 1)}</td>
                      <td>{f.number(report[name].p90, 1)}</td>
                      <td>{f.number(report[name].scenariosPerSecond, 0)}</td>
                      <td>{f.number(report[name].checksum, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <strong>{b('ratio', { ratio: f.number(report.ratio, 2) })}</strong>
            </p>
          </div>
          <div className="bench-block">
            <h3>{b('coldTitle')}</h3>
            <p>
              {b('cold', {
                wasm: f.number(report.coldStart.wasmMs, 1),
                js: f.number(report.coldStart.jsMs, 1),
              })}
            </p>
          </div>
          <div className="bench-block">
            <h3>{b('environmentTitle')}</h3>
            <dl>
              <dt>{b('browser')}</dt>
              <dd>{report.environment.userAgent}</dd>
              <dt>{b('cores')}</dt>
              <dd>{report.environment.hardwareConcurrency}</dd>
              <dt>{b('memory')}</dt>
              <dd>{report.environment.deviceMemory ?? b('unknown')}</dd>
              <dt>{b('date')}</dt>
              <dd>{report.environment.date}</dd>
            </dl>
            <button type="button" onClick={download}>
              {b('download')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
