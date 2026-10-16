import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { useFormat, useT } from '../../i18n';
import type { Pair } from './MetricsTable';

interface Props {
  labels: Pair<string>;
  cumulative: Pair<number[]>;
  currency: string;
}

const WIDTH = 640;
const HEIGHT = 300;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 72 };
// Second series dashed so the two lines differ without relying on colour.
const DASH = ['', '6 4'] as const;
const STROKE = ['var(--accent)', 'var(--text)'] as const;

export function CumulativeChart({ labels, cumulative, currency }: Props) {
  const t = useT();
  const { money } = useFormat();
  const longest = Math.max(cumulative[0].length, cumulative[1].length) - 1;
  const values = [...cumulative[0], ...cumulative[1], 0];
  const x = scaleLinear()
    .domain([0, longest])
    .range([MARGIN.left, WIDTH - MARGIN.right]);
  const y = scaleLinear()
    .domain([Math.min(...values), Math.max(...values)])
    .nice()
    .range([HEIGHT - MARGIN.bottom, MARGIN.top]);
  const path = line<number>()
    .x((_, year) => x(year))
    .y((value) => y(value));
  const end = (side: 0 | 1) => money(cumulative[side].at(-1) ?? 0, currency);

  return (
    <figure className="compare-figure">
      <figcaption>
        <strong>{t('compare.chartTitle')}</strong>
        <span className="compare-note">{t('compare.chartCaption')}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={t('compare.chartAria', {
          a: labels[0],
          b: labels[1],
          endA: end(0),
          endB: end(1),
        })}
      >
        {y.ticks(5).map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={tick === 0 ? 1.5 : 0.5}
            />
            <text x={MARGIN.left - 6} y={y(tick)} textAnchor="end" dy="0.32em" className="tick">
              {money(tick, currency)}
            </text>
          </g>
        ))}
        {x.ticks(Math.min(longest, 10)).map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={HEIGHT - MARGIN.bottom + 16}
            textAnchor="middle"
            className="tick"
          >
            {tick}
          </text>
        ))}
        <text
          x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          className="tick"
        >
          {t('compare.year')}
        </text>
        {([0, 1] as const).map((side) => (
          <path
            key={side}
            d={path(cumulative[side]) ?? ''}
            fill="none"
            stroke={STROKE[side]}
            strokeWidth={2}
            strokeDasharray={DASH[side]}
          />
        ))}
      </svg>
      <ul className="legend">
        {([0, 1] as const).map((side) => (
          <li key={side}>
            <svg width="28" height="10" aria-hidden="true">
              <line
                x1="0"
                x2="28"
                y1="5"
                y2="5"
                stroke={STROKE[side]}
                strokeWidth={2}
                strokeDasharray={DASH[side]}
              />
            </svg>
            {labels[side]}
          </li>
        ))}
      </ul>
      <details>
        <summary>{t('compare.showTable')}</summary>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">{t('compare.year')}</th>
                <th scope="col">{labels[0]}</th>
                <th scope="col">{labels[1]}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: longest + 1 }, (_, year) => (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  {([0, 1] as const).map((side) => {
                    const value = cumulative[side][year];
                    return <td key={side}>{value === undefined ? '—' : money(value, currency)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
