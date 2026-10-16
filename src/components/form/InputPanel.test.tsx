import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Inputs } from '../../engine/types';
import { en } from '../../i18n/en';
import { LocaleProvider } from '../../i18n';
import type { Locale } from '../../i18n';
import { defaultInputs, defaultMc, defaultTax } from '../../model/defaults';
import { examples } from '../../model/examples';
import { InputPanel } from './InputPanel';
import type { McSettings } from './Simulation';

interface Seen {
  inputs: Inputs;
  mc: McSettings;
}

// The state the panel last reported, read by the tests after typing.
const seen: Seen = { inputs: defaultInputs('es'), mc: defaultMc };

function Harness({ initial }: { initial: Inputs }) {
  const [inputs, setInputs] = useState(initial);
  const [mc, setMc] = useState<McSettings>(defaultMc);
  const changeInputs = (next: Inputs) => {
    seen.inputs = next;
    setInputs(next);
  };
  const changeMc = (next: McSettings) => {
    seen.mc = next;
    setMc(next);
  };
  return <InputPanel inputs={inputs} mc={mc} onInputs={changeInputs} onMc={changeMc} />;
}

function setup(locale: Locale, initial: Inputs = defaultInputs('es')) {
  seen.inputs = initial;
  seen.mc = defaultMc;
  render(
    <LocaleProvider initial={locale}>
      <Harness initial={initial} />
    </LocaleProvider>,
  );
  return { seen, user: userEvent.setup() };
}

const madrid = examples[0]?.inputs ?? defaultInputs('es');

describe('InputPanel', () => {
  it('«3,2» typed in a Spanish percent field puts 0.032 in the state', async () => {
    const { seen, user } = setup('es');
    const field = screen.getByLabelText('Tipo de interés fijo');
    await user.clear(field);
    await user.type(field, '3,2');
    expect(seen.inputs.loan).toMatchObject({ kind: 'fixed', fixed_rate: 0.032 });
    expect(field).toHaveValue('3,2');
  });

  it('«3.2» typed in an English percent field puts 0.032 in the state', async () => {
    const { seen, user } = setup('en');
    const field = screen.getByLabelText('Fixed interest rate');
    await user.clear(field);
    await user.type(field, '3.2');
    expect(seen.inputs.loan).toMatchObject({ fixed_rate: 0.032 });
  });

  it('shows 0.7 as «70» in a percent field', () => {
    setup('en');
    expect(screen.getByLabelText('Loan to value')).toHaveValue('70');
  });

  it('switching Spain to the generic market changes the visible sections and keeps the price', async () => {
    const { seen, user } = setup('en', madrid);
    expect(screen.getByLabelText('Region')).toBeInTheDocument();
    expect(screen.getByLabelText('Notary extras')).toBeInTheDocument();
    expect(screen.queryByLabelText('Closing costs')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Market'), 'generic');
    expect(screen.queryByLabelText('Region')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notary extras')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Closing costs')).toBeInTheDocument();
    expect(seen.inputs.profile).toBe('generic');
    expect(seen.inputs.price).toBe(180000);
  });

  it('switching to the US example uses dollars', async () => {
    const { seen, user } = setup('en');
    await user.selectOptions(screen.getByLabelText('Market'), 'us-example');
    expect(seen.inputs.currency).toBe('USD');
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
  });

  it('a price below zero shows the range under the field', async () => {
    const { user } = setup('en');
    const field = screen.getByLabelText('Purchase price');
    await user.clear(field);
    await user.type(field, '-5');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a value above 0, up to 1,000,000,000.')).toBeInTheDocument();
  });

  it('a percent field states its range in percent', async () => {
    const { user } = setup('en');
    const field = screen.getByLabelText('Loan to value');
    await user.clear(field);
    await user.type(field, '120');
    expect(screen.getByText('Enter a value from 0 to 100.')).toBeInTheDocument();
  });

  it('an empty required field says a value is needed; text says it is not a number', async () => {
    const { seen, user } = setup('en');
    const field = screen.getByLabelText('Monthly rent');
    await user.clear(field);
    expect(screen.getByText('Enter a value.')).toBeInTheDocument();
    expect(seen.inputs.rent_month).toBeNaN();
    await user.type(field, 'abc');
    expect(screen.getByText('Enter a number, such as 1234.5.')).toBeInTheDocument();
  });

  it('an empty optional field stores null', async () => {
    const { seen, user } = setup('en', { ...madrid, reference_value: 150000 });
    const field = screen.getByLabelText('Reference value (optional)');
    expect(field).toHaveValue('150,000');
    await user.clear(field);
    expect(seen.inputs.reference_value).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps what is typed while it still means the same number', async () => {
    const { user } = setup('es');
    const field = screen.getByLabelText('Renta mensual');
    await user.clear(field);
    await user.type(field, '950,');
    expect(field).toHaveValue('950,');
  });

  it('changing the loan type adds the fields of that type', async () => {
    const { seen, user } = setup('en');
    expect(screen.queryByLabelText('Spread over the index')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Loan type'), 'mixed');
    expect(screen.getByLabelText('Spread over the index')).toBeInTheDocument();
    expect(screen.getByLabelText('Years at the fixed rate')).toBeInTheDocument();
    expect(seen.inputs.loan).toMatchObject({ kind: 'mixed', fixed_rate: 0.035, term_years: 25 });
  });

  it('an index path typed as «2,5; 3» is stored as 0.025 and 0.03', async () => {
    const { seen, user } = setup('es');
    await user.selectOptions(screen.getByLabelText('Tipo de préstamo'), 'variable');
    const field = screen.getByLabelText('Índice por año (opcional)');
    await user.type(field, '2,5; 3');
    expect(seen.inputs.loan).toMatchObject({ index_path: [0.025, 0.03] });
  });

  it('an index entry above 20 % shows the index range under the path field', async () => {
    const { user } = setup('en');
    await user.selectOptions(screen.getByLabelText('Loan type'), 'variable');
    await user.type(screen.getByLabelText('Index by year (optional)'), '2; 25');
    expect(screen.getByText('Enter a value from -5 to 20.')).toBeInTheDocument();
  });

  it('turning the tax on shows the Spanish tax fields with their defaults', async () => {
    const { seen, user } = setup('en');
    expect(screen.queryByLabelText('Marginal income tax rate')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Include income tax (simplified)'));
    expect(seen.inputs.tax.on).toBe(true);
    expect(screen.getByLabelText('Marginal income tax rate')).toHaveValue('37');
  });

  it('the help button shows the definition and names the field', async () => {
    const { user } = setup('en');
    const button = screen.getByRole('button', { name: 'Explain: Vacancy' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(en['help.vacancy'])).toBeInTheDocument();
  });

  it('the first three sections are open and the others closed', () => {
    setup('en');
    const sections = screen.getAllByRole('group');
    const open = sections.filter((s) => s.hasAttribute('open'));
    expect(open).toHaveLength(3);
  });

  it('a correlation cell also writes its mirror and a bad matrix shows one message', async () => {
    const { seen, user } = setup('en');
    const field = screen.getByLabelText('Correlation: index and rent');
    await user.clear(field);
    await user.type(field, '0.4');
    expect(seen.mc.params.corr[0]?.[1]).toBe(0.4);
    expect(seen.mc.params.corr[1]?.[0]).toBe(0.4);
    await user.clear(field);
    await user.type(field, '1.5');
    const alerts = within(screen.getByRole('form')).getAllByRole('alert');
    expect(alerts.some((a) => a.textContent === en['error.badCorrelation'])).toBe(true);
  });

  it('more than 100,000 scenarios and a seed with decimals are refused', async () => {
    const { user } = setup('en');
    const n = screen.getByLabelText('Scenarios');
    await user.clear(n);
    await user.type(n, '100001');
    expect(screen.getByText(en['error.tooManyScenarios'])).toBeInTheDocument();
    const seed = screen.getByLabelText('Random seed');
    await user.clear(seed);
    await user.type(seed, '1.5');
    expect(screen.getByText(en['error.notInteger'])).toBeInTheDocument();
  });

  it('every field label has its help text, in both languages', async () => {
    const { es } = await import('../../i18n/es');
    for (const catalogue of [en, es]) {
      const names = Object.keys(catalogue)
        .filter((k) => k.startsWith('field.'))
        .map((k) => k.slice('field.'.length));
      for (const name of names) expect(catalogue, name).toHaveProperty(`help.${name}`);
    }
  });

  it('opens the collapsed sections that hold an invalid field', () => {
    setup('en', { ...madrid, vacancy: 5, rent_month: -3 });
    const income = screen.getByText(en['section.income']).closest('details');
    const expenses = screen.getByText(en['section.expenses']).closest('details');
    expect(income?.open).toBe(true);
    expect(expenses?.open).toBe(false);
  });

  it('names the loan term as the limit of the fixed years of a mixed loan', () => {
    const mixed = {
      ...madrid,
      loan: {
        kind: 'mixed' as const,
        fixed_rate: 0.03,
        fixed_years: 26,
        spread: 0.01,
        index: 0.03,
        term_years: 25,
      },
    };
    setup('en', mixed);
    expect(screen.getByText('Enter a value from 0 to 25.')).toBeInTheDocument();
  });

  it('says an index path of 41 values is too long, not out of range', () => {
    const variable = {
      ...madrid,
      loan: {
        kind: 'variable' as const,
        spread: 0.01,
        index: 0.03,
        index_path: Array.from({ length: 41 }, () => 0.02),
        term_years: 25,
      },
    };
    setup('en', variable);
    expect(screen.getByText(en['error.tooManyYears'])).toBeInTheDocument();
  });

  it('shows a keypad with a minus key for the fields that accept negative values', () => {
    setup('en', madrid);
    expect(screen.getByLabelText('Purchase price')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Appreciation')).toHaveAttribute('inputmode', 'text');
  });

  it('names the IPSI rate as required, not optional, for a new build in Ceuta', () => {
    setup('en', { ...defaultInputs('es', 'CE'), new_build: true });
    expect(screen.getByLabelText('IPSI rate')).toBeInTheDocument();
    expect(screen.queryByLabelText('Transfer tax rate (optional)')).toBeNull();
  });

  it('keeps the optional transfer rate for a resale in Ceuta', () => {
    setup('en', defaultInputs('es', 'CE'));
    expect(screen.getByLabelText('Transfer tax rate (optional)')).toBeInTheDocument();
  });

  it('disables the loan fields, and the loan fees, when the loan is 0 %', () => {
    setup('en', { ...madrid, ltv: 0 });
    for (const label of ['Fixed interest rate', 'Loan term', 'Loan fees'])
      expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByLabelText('Loan to value')).toBeEnabled();
  });

  it('keeps the tax settings when the box is unticked and ticked again', async () => {
    const { seen, user } = setup('en', { ...madrid, tax: defaultTax('es') });
    const rate = screen.getByLabelText('Marginal income tax rate');
    await user.clear(rate);
    await user.type(rate, '45');
    expect(seen.inputs.tax).toMatchObject({ on: true, marginal: 0.45 });
    await user.click(screen.getByLabelText('Include income tax (simplified)'));
    expect(seen.inputs.tax).toEqual({ on: false });
    await user.click(screen.getByLabelText('Include income tax (simplified)'));
    expect(seen.inputs.tax).toMatchObject({ on: true, marginal: 0.45 });
  });
});
