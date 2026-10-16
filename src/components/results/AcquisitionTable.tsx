import { useFormat, useT } from '../../i18n';
import type { Analysis, Inputs } from '../../engine/types';
import { currencyOf } from './currency';
import './results.css';

interface Row {
  label: string;
  value: number;
  total?: boolean;
}

interface Props {
  inputs: Inputs;
  analysis: Analysis;
}

export function AcquisitionTable({ inputs, analysis }: Props) {
  const t = useT();
  const { money } = useFormat();
  const a = analysis.acquisition;
  const currency = currencyOf(inputs);

  // acq_costs also holds the gestoría, the agency fee and the notary extras, which the engine does not itemise.
  const itemised = a.transfer_tax + (a.notary ?? 0) + (a.registry ?? 0);
  const other = a.acq_costs - itemised;

  // Ceuta and Melilla charge IPSI on a new build, at the rate the person typed, instead of VAT.
  const ipsi = inputs.new_build === true && (inputs.region === 'CE' || inputs.region === 'ML');
  const transferLabel = inputs.new_build
    ? ipsi
      ? `${t('term.ipsi')} + ${t('term.stampDuty')}`
      : `${t('term.vat')} + ${t('term.stampDuty')}`
    : t('term.transferTax');

  const rows: Row[] = [
    { label: t('acquisition.price'), value: inputs.price },
    { label: transferLabel, value: a.transfer_tax },
  ];
  if (a.notary !== undefined) rows.push({ label: t('term.notary'), value: a.notary });
  if (a.registry !== undefined) rows.push({ label: t('term.registry'), value: a.registry });
  rows.push(
    { label: t('acquisition.other'), value: other },
    { label: t('acquisition.renovation'), value: inputs.renovation },
    { label: t('term.totalInvestment'), value: a.total_investment, total: true },
    { label: t('acquisition.loan'), value: -a.loan },
    { label: t('acquisition.loanFees'), value: inputs.ltv > 0 ? inputs.loan_fees : 0 },
    { label: t('term.equity'), value: a.equity0, total: true },
  );

  return (
    <div className="table-scroll" role="region" aria-label={t('acquisition.caption')} tabIndex={0}>
      <table className="results-table">
        <caption>{t('acquisition.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('acquisition.item')}</th>
            <th scope="col" className="num">
              {t('acquisition.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, value, total }) => (
            <tr key={label} className={total ? 'total' : undefined}>
              <th scope="row">{label}</th>
              <td className="num">{money(value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
