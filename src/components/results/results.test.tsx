import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis, Inputs, Irr, MonthRow } from '../../engine/types';
import { LocaleProvider } from '../../i18n';
import type { Locale } from '../../i18n';
import { AcquisitionTable } from './AcquisitionTable';
import { AmortisationTable } from './AmortisationTable';
import { CashFlowTable } from './CashFlowTable';
import { IrrValue } from './IrrValue';
import { Summary } from './Summary';

interface Proforma {
  inputs: Inputs;
  result: Analysis;
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
}

function inLocale(locale: Locale, ui: ReactNode) {
  return render(<LocaleProvider initial={locale}>{ui}</LocaleProvider>);
}

afterEach(cleanup);

const f1 = fixture('proforma_F1') as Proforma;
const f2 = fixture('proforma_F2') as Proforma;
const f3 = fixture('proforma_F3') as Proforma;
const noSchedule = { ...f1.result, schedule: [] };

describe('Summary', () => {
  it('shows the F1 net yield as 4.27 % in English', () => {
    inLocale('en', <Summary inputs={f1.inputs} analysis={f1.result} />);
    const card = screen.getByText('Net yield').closest('div') as HTMLElement;
    expect(within(card).getByText('4.27 %')).toBeInTheDocument();
    expect(within(card).getByText('Year-1 NOI ÷ total investment')).toBeInTheDocument();
  });

  it('shows the F1 net yield as 4,27 % in Spanish', () => {
    inLocale('es', <Summary inputs={f1.inputs} analysis={f1.result} />);
    const card = screen.getByText('Rentabilidad neta').closest('div') as HTMLElement;
    expect(within(card).getByText('4,27 %')).toBeInTheDocument();
  });

  it('shows the F1 NPV, gross yield and DSCR from the fixture', () => {
    inLocale('en', <Summary inputs={f1.inputs} analysis={f1.result} />);
    expect(screen.getByText('€5,533', { exact: false })).toHaveTextContent('-€5,533');
    expect(screen.getByText('6.33 %')).toBeInTheDocument();
    expect(screen.getByText('1.21')).toBeInTheDocument();
  });

  it('says so when payback never happens', () => {
    inLocale('en', <Summary inputs={f1.inputs} analysis={f1.result} />);
    expect(screen.getByText('Not within the holding period')).toHaveClass('metric-text');
  });

  it('colours the F1 NPV red, a signed result, and leaves the numbers uncoloured', () => {
    inLocale('en', <Summary inputs={f1.inputs} analysis={f1.result} />);
    expect(screen.getByText('-€5,533')).toHaveClass('neg');
    expect(screen.getByText('6.33 %')).not.toHaveClass('neg');
  });

  it('hides the IRR before tax when tax is off', () => {
    const taxOff = { ...f1.inputs, tax: { on: false } };
    inLocale('en', <Summary inputs={taxOff} analysis={f1.result} />);
    expect(screen.queryByText('IRR before tax')).not.toBeInTheDocument();
  });
});

describe('IrrValue', () => {
  const cases = (fixture('irr') as { irr: Irr }[]).map((c) => c.irr);
  const unique = cases.find((c) => c.kind === 'Unique' && c.rate === 0.1) as Irr;
  const multiple = cases.find((c) => c.kind === 'Multiple') as Irr;
  const noSign = cases.find((c) => c.kind === 'None' && c.reason === 'NoSignChange') as Irr;
  const outOfRange = cases.find((c) => c.kind === 'None' && c.reason === 'OutOfRange') as Irr;

  it('renders a unique root as a percentage', () => {
    inLocale('en', <IrrValue irr={unique} />);
    expect(screen.getByText('10.00 %')).toBeInTheDocument();
  });

  it('renders the roots 10 % and 20 % and points to MIRR and NPV', () => {
    inLocale('en', <IrrValue irr={multiple} />);
    expect(
      screen.getByText('several IRRs: 10.0 % and 20.0 %; see MIRR and NPV'),
    ).toBeInTheDocument();
  });

  it('renders several roots in Spanish with the decimal comma', () => {
    inLocale('es', <IrrValue irr={multiple} />);
    expect(
      screen.getByText('varias TIR: 10,0 % y 20,0 %; véanse la TIRM y el VAN'),
    ).toBeInTheDocument();
  });

  it('explains that flows without a sign change have no IRR', () => {
    inLocale('en', <IrrValue irr={noSign} />);
    expect(screen.getByText('no IRR: the flows never change sign')).toBeInTheDocument();
  });

  it('names the searched range when the root lies outside it', () => {
    inLocale('en', <IrrValue irr={outOfRange} />);
    expect(screen.getByText('IRR outside -99 % … 1,000 %')).toBeInTheDocument();
  });
});

describe('AcquisitionTable', () => {
  it('lists the F1 purchase: 180,000 price, 10,800 transfer tax, total 207,142, equity 81,542', () => {
    inLocale('en', <AcquisitionTable inputs={f1.inputs} analysis={f1.result} />);
    const row = (name: string) =>
      screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement;
    expect(within(row('Price')).getByText('€180,000')).toBeInTheDocument();
    expect(within(row('Transfer tax')).getByText('€10,800')).toBeInTheDocument();
    expect(within(row('Total investment')).getByText('€207,142')).toBeInTheDocument();
    expect(within(row('Equity')).getByText('€81,542')).toBeInTheDocument();
  });

  it('adds up to the engine total in every fixture, the rows being price, costs and renovation', () => {
    for (const { inputs, result } of [f1, f2, f3]) {
      const a = result.acquisition;
      expect(inputs.price + a.acq_costs + inputs.renovation).toBeCloseTo(a.total_investment, 9);
      expect(a.total_investment - a.loan + inputs.loan_fees).toBeCloseTo(a.equity0, 9);
    }
  });

  it('shows no loan fees when there is no loan', () => {
    const inputs = { ...f1.inputs, ltv: 0 };
    inLocale('en', <AcquisitionTable inputs={inputs} analysis={f1.result} />);
    const row = screen.getByRole('rowheader', { name: 'Loan fees' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('€0')).toBeInTheDocument();
  });

  it('shows dollars for the US-style example', () => {
    inLocale('en', <AcquisitionTable inputs={f3.inputs} analysis={f3.result} />);
    expect(screen.getAllByText(/^\$/, { selector: 'td' }).length).toBeGreaterThan(0);
  });

  it('names VAT and stamp duty for a new build', () => {
    inLocale('en', <AcquisitionTable inputs={f2.inputs} analysis={f2.result} />);
    expect(
      screen.getByRole('rowheader', { name: 'VAT (IGIC in the Canary Islands) + Stamp duty' }),
    ).toBeInTheDocument();
  });

  it('names IPSI for a new build in Ceuta', () => {
    const inputs = { ...f2.inputs, region: 'CE', manual_transfer_rate: 0.04 };
    inLocale('en', <AcquisitionTable inputs={inputs} analysis={f2.result} />);
    expect(screen.getByRole('rowheader', { name: 'IPSI + Stamp duty' })).toBeInTheDocument();
  });
});

describe('CashFlowTable', () => {
  it('has a purchase row, ten years and a sale row for F1', () => {
    inLocale('en', <CashFlowTable inputs={f1.inputs} analysis={f1.result} />);
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1 + 10 + 1 + 1);
  });

  it('totals the after-tax column to the sum of the engine flows, 49,409 for F1', () => {
    inLocale('en', <CashFlowTable inputs={f1.inputs} analysis={f1.result} />);
    const sum = f1.result.flows.reduce((a, b) => a + b, 0);
    expect(Math.round(sum)).toBe(49409);
    const total = screen.getByRole('rowheader', { name: 'Total' }).closest('tr') as HTMLElement;
    expect(within(total).getByText('€49,409')).toBeInTheDocument();
  });

  it('ends the cumulative column at the engine value, sale included', () => {
    inLocale('en', <CashFlowTable inputs={f1.inputs} analysis={f1.result} />);
    const sale = screen.getByRole('rowheader', { name: 'Sale' }).closest('tr') as HTMLElement;
    const cumulative = f1.result.cumulative.at(-1) as number;
    const cells = within(sale).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent(`€${Math.round(cumulative).toLocaleString('en')}`);
  });
});

describe('AmortisationTable', () => {
  const schedule: MonthRow[] = Array.from({ length: 24 }, (_, i) => ({
    month: i + 1,
    rate: 0.03,
    payment: 100,
    interest: 10,
    principal: 90,
    balance: 2400 - 90 * (i + 1),
  }));
  const analysis = { ...f1.result, schedule };

  it('groups months into years: two rows, each 1,200 paid and 1,080 of principal, balance 1,320 after year 1', () => {
    inLocale('en', <AmortisationTable inputs={f1.inputs} analysis={analysis} />);
    const year1 = screen.getByRole('rowheader', { name: '1' }).closest('tr') as HTMLElement;
    expect(within(year1).getByText('€1,200')).toBeInTheDocument();
    expect(within(year1).getByText('€1,080')).toBeInTheDocument();
    expect(within(year1).getByText('€1,320')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2 + 1);
  });

  it('totals 2,400 paid, 240 of interest and 2,160 of principal', () => {
    inLocale('en', <AmortisationTable inputs={f1.inputs} analysis={analysis} />);
    const total = screen.getByRole('rowheader', { name: 'Total' }).closest('tr') as HTMLElement;
    expect(within(total).getByText('€2,400')).toBeInTheDocument();
    expect(within(total).getByText('€240')).toBeInTheDocument();
    expect(within(total).getByText('€2,160')).toBeInTheDocument();
  });

  it('shows 24 month rows after the toggle', () => {
    inLocale('en', <AmortisationTable inputs={f1.inputs} analysis={analysis} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show months' }));
    expect(screen.getAllByRole('row')).toHaveLength(1 + 24 + 1);
  });

  it('says there is no loan when the schedule is empty', () => {
    inLocale('en', <AmortisationTable inputs={f1.inputs} analysis={noSchedule} />);
    expect(screen.getByText('No loan.')).toBeInTheDocument();
  });
});
