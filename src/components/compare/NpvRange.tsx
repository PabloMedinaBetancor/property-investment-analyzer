import { scaleLinear } from 'd3-scale';
import { useEffect, useRef, useState } from 'react';
import type { McResult } from '../../engine/types';
import { useFormat, useT } from '../../i18n';
import { edgeAnchor, tickCount } from '../charts/scales';
import type { Pair } from './MetricsTable';

interface Props {
  labels: Pair<string>;
  risks: Pair<McResult>;
  currencies: Pair<string>;
  n: number;
}

const DEFAULT_WIDTH = 640;
const ROW = 36;
const MARGIN = { left: 16, right: 16, top: 12, bottom: 24 };

export function NpvRange({ labels, risks, currencies, n }: Props) {
  const t = useT();
  const { money, number, percent } = useFormat();
  // One shared axis only means something in one currency.
  const comparable = currencies[0] === currencies[1];
  // Drawn at the width it is shown at, so that the labels keep their size and the ticks their room on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(280, Math.round(w)));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [comparable]);
  const all = [...risks[0].npv_p, ...risks[1].npv_p, 0];
  const x = scaleLinear()
    .domain([Math.min(...all), Math.max(...all)])
    .nice()
    .range([MARGIN.left, width - MARGIN.right]);
  const height = MARGIN.top + 2 * ROW + MARGIN.bottom;
  const range = (side: 0 | 1) =>
    `${money(risks[side].npv_p[0], currencies[side])} – ${money(risks[side].npv_p[2], currencies[side])}`;

  return (
    <figure className="compare-figure">
      <figcaption>
        <strong>{t('compare.riskTitle')}</strong>
        <span className="compare-note">{t('compare.riskCaption', { n: number(n, 0) })}</span>
      </figcaption>
      {comparable && (
        <div ref={box}>
          <svg
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-label={t('compare.riskAria', {
              a: labels[0],
              b: labels[1],
              rangeA: range(0),
              rangeB: range(1),
            })}
          >
            <line
              x1={x(0)}
              x2={x(0)}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
              stroke="var(--muted)"
              strokeDasharray="2 3"
            />
            {([0, 1] as const).map((side) => {
              const [low, mid, high] = risks[side].npv_p;
              const y = MARGIN.top + ROW * side + ROW / 2;
              return (
                <g key={side}>
                  <rect
                    x={x(low)}
                    y={y - 7}
                    width={x(high) - x(low)}
                    height={14}
                    fill="var(--band)"
                    stroke="var(--accent)"
                  />
                  <line
                    x1={x(mid)}
                    x2={x(mid)}
                    y1={y - 11}
                    y2={y + 11}
                    stroke="var(--text)"
                    strokeWidth={2}
                  />
                  <text x={x(low)} y={y - 12} className="tick">
                    {labels[side]}
                  </text>
                </g>
              );
            })}
            {x.ticks(tickCount(width - MARGIN.left - MARGIN.right)).map((tick) => (
              <text
                key={tick}
                x={x(tick)}
                y={height - 6}
                textAnchor={edgeAnchor(x(tick), MARGIN.left, width - MARGIN.right)}
                className="tick"
              >
                {money(tick, currencies[0])}
              </text>
            ))}
          </svg>
        </div>
      )}
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">{t('term.scenario')}</th>
              <th scope="col">P10</th>
              <th scope="col">P50</th>
              <th scope="col">P90</th>
              <th scope="col">{t('compare.pNegative')}</th>
            </tr>
          </thead>
          <tbody>
            {([0, 1] as const).map((side) => (
              <tr key={side}>
                <th scope="row">{labels[side]}</th>
                {risks[side].npv_p.map((value, i) => (
                  <td key={i}>{money(value, currencies[side])}</td>
                ))}
                <td>{percent(risks[side].p_npv_negative, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
