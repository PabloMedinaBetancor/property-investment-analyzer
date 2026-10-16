import type { ReactNode } from 'react';
import type { Analysis, Inputs } from '../../engine/types';
import { useFormat, useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { IrrValue } from '../results/IrrValue';
import { Amount } from '../results/Amount';
import { currencyOf } from '../results/currency';
import { digitsOf } from '../results/digits';
import './compare.css';

export type Pair<T> = [T, T];

type Kind = 'money' | 'percent' | 'ratio' | 'years';

interface Row {
  term: MessageKey;
  kind: Kind;
  // Which direction wins; null when neither does (a bigger purchase is not a better one).
  better: 'higher' | 'lower' | null;
  value: (analysis: Analysis) => number | null;
}

const ROWS: Row[] = [
  { term: 'term.npv', kind: 'money', better: 'higher', value: (a) => a.metrics.npv },
  {
    term: 'term.irr',
    kind: 'percent',
    better: 'higher',
    value: (a) => (a.metrics.irr.kind === 'Unique' ? a.metrics.irr.rate : null),
  },
  { term: 'term.mirr', kind: 'percent', better: 'higher', value: (a) => a.metrics.mirr },
  {
    term: 'term.cashOnCash',
    kind: 'percent',
    better: 'higher',
    value: (a) => a.metrics.cash_on_cash_1,
  },
  { term: 'term.netYield', kind: 'percent', better: 'higher', value: (a) => a.metrics.net_yield },
  {
    term: 'term.grossYield',
    kind: 'percent',
    better: 'higher',
    value: (a) => a.metrics.gross_yield,
  },
  { term: 'term.capRate', kind: 'percent', better: 'higher', value: (a) => a.metrics.cap_rate },
  { term: 'term.dscr', kind: 'ratio', better: 'higher', value: (a) => a.metrics.dscr },
  {
    term: 'term.breakEvenOccupancy',
    kind: 'percent',
    better: 'lower',
    value: (a) => a.metrics.break_even_occupancy,
  },
  { term: 'term.grm', kind: 'ratio', better: 'lower', value: (a) => a.metrics.grm },
  { term: 'term.payback', kind: 'years', better: 'lower', value: (a) => a.metrics.payback_years },
  {
    term: 'term.totalInvestment',
    kind: 'money',
    better: null,
    value: (a) => a.acquisition.total_investment,
  },
];

interface Props {
  labels: Pair<string>;
  inputs: Pair<Inputs>;
  analyses: Pair<Analysis>;
}

export function MetricsTable({ labels, inputs, analyses }: Props) {
  const t = useT();
  const { money, percent, number, years } = useFormat();
  const currencies = [currencyOf(inputs[0]), currencyOf(inputs[1])] as const;
  const sameCurrency = currencies[0] === currencies[1];

  function show(row: Row, value: number | null, side: 0 | 1): ReactNode {
    if (row.term === 'term.irr') return <IrrValue irr={analyses[side].metrics.irr} />;
    if (value === null) return row.term === 'term.payback' ? t('summary.paybackNever') : '—';
    const digits = digitsOf(row.term);
    if (row.kind === 'money') {
      return <Amount signed={row.term === 'term.npv'} value={value} currency={currencies[side]} />;
    }
    if (row.kind === 'percent') return percent(value, digits);
    if (row.kind === 'years') return years(value);
    return number(value, digits);
  }

  function difference(row: Row, a: number | null, b: number | null): string {
    if (a === null || b === null) return '—';
    if (row.kind === 'money' && !sameCurrency) return '—';
    const diff = b - a;
    // The sign goes by the value as it is written: a gap that rounds to zero is neither a gain nor a loss.
    const plus = (shown: number, digits: number) => (shown >= 0.5 * 10 ** -digits ? '+' : '');
    if (row.kind === 'money') return plus(diff, 0) + money(diff, currencies[0]);
    const digits = digitsOf(row.term);
    if (row.kind === 'percent')
      return `${plus(diff * 100, digits)}${number(diff * 100, digits)} ${t('compare.pp')}`;
    if (row.kind === 'years') return plus(diff, 1) + years(diff);
    return plus(diff, digits) + number(diff, digits);
  }

  function winner(row: Row, a: number | null, b: number | null): 0 | 1 | null {
    if (row.better === null || a === null || b === null || a === b) return null;
    if (row.kind === 'money' && !sameCurrency) return null;
    return b > a === (row.better === 'higher') ? 1 : 0;
  }

  return (
    <section aria-labelledby="compare-metrics">
      <h3 id="compare-metrics">{t('compare.metrics')}</h3>
      {!sameCurrency && <p className="compare-note">{t('compare.currencies')}</p>}
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">{t('compare.metric')}</th>
              <th scope="col">{labels[0]}</th>
              <th scope="col">{labels[1]}</th>
              <th scope="col">{t('compare.difference')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const a = row.value(analyses[0]);
              const b = row.value(analyses[1]);
              const best = winner(row, a, b);
              return (
                <tr key={row.term}>
                  <th scope="row">{t(row.term)}</th>
                  {([0, 1] as const).map((side) => (
                    <td
                      key={side}
                      className={(side === 0 ? a : b) === null ? 'compare-text' : undefined}
                    >
                      {show(row, side === 0 ? a : b, side)}
                      {best === side && <span className="better-mark">{t('compare.better')}</span>}
                    </td>
                  ))}
                  <td>{difference(row, a, b)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
