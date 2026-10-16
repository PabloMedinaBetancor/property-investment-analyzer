import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Analysis, McResult, Sensitivity } from '../../engine/types';
import { LocaleProvider } from '../../i18n';
import { CashFlowChart } from './CashFlowChart';
import { McBandChart } from './McBandChart';
import { NpvHistogram } from './NpvHistogram';
import { PercentileStrip } from './PercentileStrip';
import { TornadoChart } from './TornadoChart';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve('tests/fixtures', name), 'utf8')) as Record<
    string,
    unknown
  >;
}

const f1 = fixture('proforma_F1.json').result as Analysis;
const mcF1 = fixture('monte_carlo_F1_n2000_seed42.json') as unknown as McResult;
const mcF2 = fixture('monte_carlo_F2_n2000_seed42.json') as unknown as McResult;
const sensitivityF1 = fixture('sensitivity_F1.json') as unknown as Sensitivity;

const inEnglish = (ui: React.ReactElement) =>
  render(<LocaleProvider initial="en">{ui}</LocaleProvider>);

describe('CashFlowChart', () => {
  it('draws 11 bars for F1 (year 0 to 10) and a cumulative line ending at 49 409', () => {
    const { container } = inEnglish(<CashFlowChart analysis={f1} currency="EUR" />);
    expect(container.querySelectorAll('rect.bar')).toHaveLength(11);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/49,409/);
  });

  it('the table toggle lists every year with the cumulative total 49,409 in the last row', () => {
    inEnglish(<CashFlowChart analysis={f1} currency="EUR" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(12);
    expect(rows[11]?.textContent).toMatch(/49,409/);
  });
});

describe('the table toggle', () => {
  it('keeps one label that changes with the view, is not a pressed toggle, and controls the view', () => {
    const { container } = inEnglish(<CashFlowChart analysis={f1} currency="EUR" />);
    const button = screen.getByRole('button', { name: 'Show as table' });
    expect(button).not.toHaveAttribute('aria-pressed');
    const view = button.getAttribute('aria-controls') ?? '';
    expect(container.querySelector(`[id="${view}"]`)).toContainElement(screen.getByRole('img'));
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Show as chart' })).not.toHaveAttribute(
      'aria-pressed',
    );
    expect(container.querySelector(`[id="${view}"]`)).toContainElement(screen.getByRole('table'));
  });
});

describe('McBandChart', () => {
  it('the band has N+1 = 11 points for the 10-year fixture', () => {
    const { container } = inEnglish(
      <McBandChart mc={mcF1} n={2000} base={f1.cumulative} currency="EUR" />,
    );
    expect(container.querySelector('path.band')?.getAttribute('data-points')).toBe('11');
  });
});

describe('PercentileStrip', () => {
  it('shows P(NPV < 0) of F1 as 67.9 % and the three excluded counts', () => {
    const { container } = inEnglish(<PercentileStrip mc={mcF1} currency="EUR" />);
    expect(container.querySelector('.chart-note')?.textContent).toMatch(
      /67\.9.%.*0 with several IRRs, 0 below −99 %, 0 above 1,000 %/,
    );
  });

  it('F2 reports the one scenario below −99 %', () => {
    const { container } = inEnglish(<PercentileStrip mc={mcF2} currency="EUR" />);
    expect(container.querySelector('.chart-note')?.textContent).toMatch(/1 below −99 %/);
  });

  it('writes «below» and «above» in words when a percentile is outside the range', () => {
    const mc: McResult = { ...mcF1, irr_p: ['below', 0.04, 'above'] };
    inEnglish(<PercentileStrip mc={mc} currency="EUR" />);
    expect(screen.getByText('below −99 %')).toBeInTheDocument();
    expect(screen.getByText('above 1,000 %')).toBeInTheDocument();
  });

  it('says so when every scenario had several IRRs (irr_p null)', () => {
    inEnglish(<PercentileStrip mc={{ ...mcF1, irr_p: null }} currency="EUR" />);
    expect(
      screen.getByText('No IRR percentiles: every scenario had several IRRs.'),
    ).toBeInTheDocument();
  });
});

describe('NpvHistogram', () => {
  it('draws 30 bins and names the scenarios outside them', () => {
    const { container } = inEnglish(<NpvHistogram mc={mcF1} currency="EUR" />);
    expect(container.querySelectorAll('rect.bar')).toHaveLength(30);
    const { below, above } = mcF1.npv_histogram;
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Histogram of NPV; ${String(below)} scenarios below the range, ${String(above)} above.`,
    );
  });
});

// Every scenario has the same NPV (all volatilities and the vacancy at 0, or one to three scenarios).
function sameForAll(scenarios: number): McResult {
  const value = -1825.4;
  return {
    ...mcF1,
    npv_p: [value, value, value],
    irr_p: [0.057, 0.057, 0.057],
    npv_histogram: {
      edges: Array.from({ length: 31 }, () => value),
      counts: [scenarios, ...Array.from({ length: 29 }, () => 0)],
      below: 0,
      above: 0,
    },
  };
}

describe('when every scenario has the same NPV', () => {
  it.each([10000, 3, 1])('the histogram draws one visible bar for %i scenarios', (n) => {
    const { container } = inEnglish(<NpvHistogram mc={sameForAll(n)} currency="EUR" />);
    const bars = [...container.querySelectorAll('rect.bar')];
    const drawn = bars.filter(
      (bar) => Number(bar.getAttribute('width')) > 1 && Number(bar.getAttribute('height')) > 1,
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.textContent).toMatch(new RegExp(`: ${n.toLocaleString('en')}$`));
  });

  it('the y axis labels are whole numbers, none repeated', () => {
    const { container } = inEnglish(<NpvHistogram mc={sameForAll(3)} currency="EUR" />);
    const labels = [...container.querySelectorAll('.axis')][0]?.querySelectorAll('text.tick');
    const texts = [...(labels ?? [])].map((x) => x.textContent);
    expect(texts.length).toBeGreaterThan(1);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text).toMatch(/^\d+$/);
  });

  it('the x axis labels are not repeated', () => {
    const { container } = inEnglish(<NpvHistogram mc={sameForAll(10000)} currency="EUR" />);
    const texts = [...container.querySelectorAll('.axis')][1]?.querySelectorAll('text.tick') ?? [];
    const labels = [...texts].map((x) => x.textContent);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('the percentile strip says each value once, under one set of names', () => {
    const { container } = inEnglish(<PercentileStrip mc={sameForAll(10000)} currency="EUR" />);
    expect(screen.getAllByText(/^[-−]€1,825$/)).toHaveLength(1);
    expect(screen.getAllByText('5.7 %')).toHaveLength(1);
    expect(container.querySelectorAll('text.tick')).toHaveLength(2);
    expect(container.querySelector('text.tick')?.textContent).toMatch(/P10.*P50.*P90/);
  });

  it('the tables render without duplicate-key warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    inEnglish(<NpvHistogram mc={sameForAll(10000)} currency="EUR" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getAllByRole('row')).toHaveLength(31);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('TornadoChart', () => {
  it('lists the bars in the engine order, largest swing first (appreciation, rent, interest…)', () => {
    inEnglish(<TornadoChart sensitivity={sensitivityF1} currency="EUR" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.firstChild?.textContent);
    expect(names).toEqual([
      'Appreciation',
      'Monthly rent',
      'Interest rate',
      'Price',
      'Vacancy',
      'Rent growth',
      'Operating expenses',
    ]);
  });
});
