import type { ReactNode } from 'react';
import { useFormat, useT } from '../../i18n';
import type { Analysis, Inputs } from '../../engine/types';
import { Amount } from './Amount';
import { currencyOf } from './currency';
import { digitsOf } from './digits';
import { IrrValue } from './IrrValue';
import './results.css';

interface Props {
  inputs: Inputs;
  analysis: Analysis;
}

interface Card {
  term: string;
  value: ReactNode;
  definition: string;
  // A sentence in place of a number is set in the definition's size.
  text?: boolean;
}

export function Summary({ inputs, analysis }: Props) {
  const t = useT();
  const { percent, number, years } = useFormat();
  const m = analysis.metrics;
  const none = '—';
  const discount = percent(inputs.discount_rate, 2);

  const cards: Card[] = [
    {
      term: t('term.grossYield'),
      value: percent(m.gross_yield, digitsOf('term.grossYield')),
      definition: t('summary.grossYield'),
    },
    {
      term: t('term.netYield'),
      value: percent(m.net_yield, digitsOf('term.netYield')),
      definition: t('summary.netYield'),
    },
    {
      term: t('term.capRate'),
      value: percent(m.cap_rate, digitsOf('term.capRate')),
      definition: t('summary.capRate'),
    },
    {
      term: t('term.cashOnCash'),
      value:
        m.cash_on_cash_1 === null ? none : percent(m.cash_on_cash_1, digitsOf('term.cashOnCash')),
      definition: t('summary.cashOnCash'),
    },
    {
      term: t('term.dscr'),
      value: m.dscr === null ? t('summary.noLoan') : number(m.dscr, digitsOf('term.dscr')),
      definition: t('summary.dscr'),
      text: m.dscr === null,
    },
    {
      term: t('term.grm'),
      value: number(m.grm, digitsOf('term.grm')),
      definition: t('summary.grm'),
    },
    {
      term: t('term.onePercentRule'),
      value: percent(m.one_percent_ratio, digitsOf('term.onePercentRule')),
      definition: `${t('summary.onePercentRule')} ${t(
        m.one_percent_ratio >= 0.01 ? 'summary.onePercentMet' : 'summary.onePercentNotMet',
      )}`,
    },
    {
      term: t('term.breakEvenOccupancy'),
      value: percent(m.break_even_occupancy, digitsOf('term.breakEvenOccupancy')),
      definition: t('summary.breakEvenOccupancy'),
    },
    {
      term: t('term.npv'),
      value: <Amount signed value={m.npv} currency={currencyOf(inputs)} />,
      definition: t('summary.npv', { rate: discount }),
    },
    { term: t('term.irr'), value: <IrrValue irr={m.irr} />, definition: t('summary.irr') },
    ...(inputs.tax.on
      ? [
          {
            term: t('summary.irrPreTax'),
            value: <IrrValue irr={m.irr_pre_tax} />,
            definition: t('summary.irrPreTaxDefinition'),
          },
        ]
      : []),
    {
      term: t('term.mirr'),
      value: m.mirr === null ? none : percent(m.mirr, digitsOf('term.mirr')),
      definition: t('summary.mirr', { rate: discount }),
    },
    {
      term: t('term.payback'),
      value: m.payback_years === null ? t('summary.paybackNever') : years(m.payback_years),
      definition: t('summary.payback'),
      text: m.payback_years === null,
    },
  ];

  return (
    <dl className="metric-cards">
      {cards.map((card) => (
        <div className="metric-card" key={card.term}>
          <dt>{card.term}</dt>
          <dd className={card.text ? 'metric-value metric-text' : 'metric-value'}>{card.value}</dd>
          <dd className="metric-definition">{card.definition}</dd>
        </div>
      ))}
    </dl>
  );
}
