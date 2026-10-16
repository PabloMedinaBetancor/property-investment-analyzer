import { useFormat, useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import type { Analysis, Inputs } from '../../engine/types';
import { currencyOf } from './currency';
import './results.css';

interface Props {
  inputs: Inputs;
  analysis: Analysis;
}

interface Row {
  label: string;
  rent?: number;
  vacancy?: number;
  opex?: number;
  noi?: number;
  debtService?: number;
  preTax?: number;
  tax?: number;
  afterTax: number;
  cumulative?: number;
}

type Column = Exclude<keyof Row, 'label' | 'cumulative'>;

const COLUMNS: { field: Column; header: MessageKey }[] = [
  { field: 'rent', header: 'cashFlow.rent' },
  { field: 'vacancy', header: 'cashFlow.vacancy' },
  { field: 'opex', header: 'term.operatingExpenses' },
  { field: 'noi', header: 'term.noi' },
  { field: 'debtService', header: 'cashFlow.debtService' },
  { field: 'preTax', header: 'cashFlow.preTax' },
  { field: 'tax', header: 'cashFlow.tax' },
  { field: 'afterTax', header: 'cashFlow.afterTax' },
];

export function CashFlowTable({ inputs, analysis }: Props) {
  const t = useT();
  const { money } = useFormat();
  const currency = currencyOf(inputs);
  const { years, exit, flows, flows_pre_tax: flowsPreTax, cumulative } = analysis;
  const last = years.length;

  // Costs are shown negative so every column adds up to its total.
  const rows: Row[] = [
    {
      label: t('cashFlow.purchase'),
      preTax: flowsPreTax[0],
      afterTax: flows[0] ?? 0,
      cumulative: cumulative[0],
    },
    ...years.map((y) => ({
      label: String(y.t),
      rent: y.rent_gross,
      vacancy: -(y.rent_gross - y.rent_collected),
      opex: -y.opex,
      noi: y.noi,
      debtService: -y.debt_service,
      preTax: y.cf_pre_tax,
      tax: -y.tax,
      afterTax: y.cf_after_tax,
      // The engine's cumulative at the last year already includes the sale, which has its own row.
      cumulative:
        y.t === last ? (cumulative[y.t] ?? 0) - exit.equity_back_after_tax : cumulative[y.t],
    })),
    {
      label: t('cashFlow.sale'),
      preTax: exit.equity_back_pre_tax,
      tax: -exit.cgt,
      afterTax: exit.equity_back_after_tax,
      cumulative: cumulative[last],
    },
  ];

  const total = (field: Column): number => rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);

  return (
    <div className="table-scroll" role="region" aria-label={t('cashFlow.caption')} tabIndex={0}>
      <table className="results-table">
        <caption>{t('cashFlow.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('cashFlow.year')}</th>
            {COLUMNS.map(({ field, header }) => (
              <th scope="col" className="num" key={field}>
                {t(header)}
              </th>
            ))}
            <th scope="col" className="num">
              {t('cashFlow.cumulative')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {COLUMNS.map(({ field }) => (
                <td className="num" key={field}>
                  {row[field] === undefined ? '' : money(row[field], currency)}
                </td>
              ))}
              <td className="num">
                {row.cumulative === undefined ? '' : money(row.cumulative, currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total">
            <th scope="row">{t('cashFlow.total')}</th>
            {COLUMNS.map(({ field }) => (
              <td className="num" key={field}>
                {money(total(field), currency)}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
