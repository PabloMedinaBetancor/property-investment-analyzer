import { useState } from 'react';
import { useFormat, useT } from '../../i18n';
import type { Analysis, Inputs, MonthRow } from '../../engine/types';
import { currencyOf } from './currency';
import './results.css';

interface Props {
  inputs: Inputs;
  analysis: Analysis;
}

interface Row {
  period: number;
  rate: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

// One row per loan year: flows add up, the rate and the balance are those of the year's last month.
function byYear(months: MonthRow[]): Row[] {
  const rows: Row[] = [];
  for (const m of months) {
    const year = Math.ceil(m.month / 12);
    const row = rows[year - 1];
    if (row === undefined) {
      rows.push({ ...m, period: year });
    } else {
      row.payment += m.payment;
      row.interest += m.interest;
      row.principal += m.principal;
      row.rate = m.rate;
      row.balance = m.balance;
    }
  }
  return rows;
}

export function AmortisationTable({ inputs, analysis }: Props) {
  const t = useT();
  const { money, percent } = useFormat();
  const [monthly, setMonthly] = useState(false);
  const currency = currencyOf(inputs);
  const months = analysis.schedule;

  if (months.length === 0) return <p>{t('amortisation.none')}</p>;

  const rows: Row[] = monthly ? months.map((m) => ({ ...m, period: m.month })) : byYear(months);
  const sum = (field: 'payment' | 'interest' | 'principal') =>
    months.reduce((total, m) => total + m[field], 0);

  return (
    <div>
      <button
        type="button"
        className="toggle"
        onClick={() => {
          setMonthly(!monthly);
        }}
      >
        {t(monthly ? 'amortisation.showYears' : 'amortisation.showMonths')}
      </button>
      <div
        className="table-scroll"
        role="region"
        aria-label={t('amortisation.caption')}
        tabIndex={0}
      >
        <table className="results-table">
          <caption>{t('amortisation.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(monthly ? 'amortisation.month' : 'cashFlow.year')}</th>
              <th scope="col" className="num">
                {t('amortisation.rate')}
              </th>
              <th scope="col" className="num">
                {t('amortisation.payment')}
              </th>
              <th scope="col" className="num">
                {t('amortisation.interest')}
              </th>
              <th scope="col" className="num">
                {t('amortisation.principal')}
              </th>
              <th scope="col" className="num">
                {t('term.loanBalance')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period}>
                <th scope="row">{row.period}</th>
                <td className="num">{percent(row.rate, 2)}</td>
                <td className="num">{money(row.payment, currency)}</td>
                <td className="num">{money(row.interest, currency)}</td>
                <td className="num">{money(row.principal, currency)}</td>
                <td className="num">{money(row.balance, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <th scope="row">{t('cashFlow.total')}</th>
              <td />
              <td className="num">{money(sum('payment'), currency)}</td>
              <td className="num">{money(sum('interest'), currency)}</td>
              <td className="num">{money(sum('principal'), currency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
