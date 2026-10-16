import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis, Inputs } from '../../engine/types';
import { LocaleProvider } from '../../i18n';
import { MetricsTable } from './MetricsTable';

interface Proforma {
  inputs: Inputs;
  result: Analysis;
}

const f1 = JSON.parse(readFileSync('tests/fixtures/proforma_F1.json', 'utf8')) as Proforma;

afterEach(cleanup);

function renderF1() {
  render(
    <LocaleProvider initial="en">
      <MetricsTable
        labels={['A', 'B']}
        inputs={[f1.inputs, f1.inputs]}
        analyses={[f1.result, f1.result]}
      />
    </LocaleProvider>,
  );
}

describe('MetricsTable', () => {
  it('writes a payback that never happens as on the Analyze page', () => {
    renderF1();
    const row = screen.getByText('Payback').closest('tr') as HTMLElement;
    expect(within(row).getAllByText('Not within the holding period')).toHaveLength(2);
  });

  it('shows the F1 GRM with one decimal, as the Analyze summary does', () => {
    renderF1();
    const row = screen.getByText('GRM').closest('tr') as HTMLElement;
    expect(within(row).getAllByText('15.8')).toHaveLength(2);
  });

  it('leaves the total investment uncoloured and colours the NPV', () => {
    renderF1();
    const investment = screen.getByText('Total investment').closest('tr') as HTMLElement;
    expect(investment.querySelector('.neg, .pos')).toBeNull();
    const npv = screen.getByText('NPV').closest('tr') as HTMLElement;
    expect(npv.querySelector('.neg')).not.toBeNull();
  });

  it('writes a difference that rounds to zero without a plus sign', () => {
    const near: Analysis = {
      ...f1.result,
      acquisition: {
        ...f1.result.acquisition,
        total_investment: f1.result.acquisition.total_investment + 0.3,
      },
      metrics: {
        ...f1.result.metrics,
        npv: f1.result.metrics.npv + 0.3,
        net_yield: f1.result.metrics.net_yield + 0.00001,
        grm: f1.result.metrics.grm + 0.2,
        payback_years: 7,
      },
    };
    const a: Analysis = {
      ...near,
      metrics: {
        ...near.metrics,
        npv: f1.result.metrics.npv,
        net_yield: f1.result.metrics.net_yield,
        grm: f1.result.metrics.grm,
        payback_years: 7.04,
      },
    };
    render(
      <LocaleProvider initial="en">
        <MetricsTable labels={['A', 'B']} inputs={[f1.inputs, f1.inputs]} analyses={[a, near]} />
      </LocaleProvider>,
    );
    const gap = (term: string) => {
      const cells = within(screen.getByText(term).closest('tr') as HTMLElement).getAllByRole(
        'cell',
      );
      return cells[cells.length - 1]?.textContent ?? '';
    };
    expect(gap('NPV')).not.toContain('+');
    expect(gap('NPV')).toContain('0');
    expect(gap('Net yield')).not.toContain('+');
    expect(gap('Net yield')).toContain('0.00 pp');
    expect(gap('Payback')).not.toMatch(/[+-]/);
    expect(gap('GRM')).toBe('+0.2');
  });
});
