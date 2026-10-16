import { scaleLinear } from 'd3-scale';
import type { McResult } from '../../engine/types';
import { useFormat, useLocale } from '../../i18n';
import { AxisX, AxisY } from './Axis';
import { ChartFrame } from './ChartFrame';
import { useChartT } from './useChartT';
import { MARGIN, compact, tickCount } from './scales';

const HEIGHT = 300;

export function NpvHistogram({ mc, currency }: { mc: McResult; currency: string }) {
  const t = useChartT();
  const f = useFormat();
  const { locale } = useLocale();
  const { edges, counts, below, above } = mc.npv_histogram;
  const first = edges[0] ?? 0;
  const last = edges[edges.length - 1] ?? 0;
  // All scenarios at one value (no randomness, or one to three scenarios): the engine's bins have no width, so the
  // whole count is drawn as one bar around that value.
  const single = last - first < 0.01;
  const pad = Math.max(Math.abs(first) * 0.1, 1);
  const lo0 = single ? first - pad : first;
  const hi0 = single ? first + pad : last;
  const total = counts.reduce((a, b) => a + b, 0);
  const bars = single
    ? [{ lo: first - pad / 4, hi: first + pad / 4, count: total }]
    : counts.map((count, i) => ({ lo: edges[i] ?? 0, hi: edges[i + 1] ?? 0, count }));
  const vars = { below: f.number(below, 0), above: f.number(above, 0) };

  return (
    <ChartFrame
      caption={t('histCaption', vars)}
      label={t('histLabel', vars)}
      height={HEIGHT}
      legend={[
        { label: `${t('npvRow')} < 0`, className: 'mark-neg' },
        { label: `${t('npvRow')} ≥ 0`, className: 'mark-pos' },
      ]}
      table={{
        head: [t('from'), t('to'), t('scenarios')],
        rows: counts.map((count, i) => [
          f.money(edges[i] ?? 0, currency),
          f.money(edges[i + 1] ?? 0, currency),
          f.number(count, 0),
        ]),
      }}
    >
      {(width) => {
        const x = scaleLinear()
          .domain([lo0, hi0])
          .range([MARGIN.left, width - MARGIN.right]);
        const y = scaleLinear()
          .domain([0, Math.max(...bars.map((bar) => bar.count), 1)])
          .nice(5)
          .range([HEIGHT - MARGIN.bottom, MARGIN.top]);
        // One tick at the value when there is no spread; elsewhere, compact labels that repeat are dropped.
        const ticks = single
          ? [{ pos: x(first), label: f.money(first, currency) }]
          : x
              .ticks(tickCount(width - MARGIN.left - MARGIN.right))
              .map((v) => ({ pos: x(v), label: compact(v, locale) }))
              .filter((tick, i, all) => tick.label !== all[i - 1]?.label);
        return (
          <>
            <AxisY
              scale={y}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              format={(v) => f.number(v, 0)}
              integers
            />
            <AxisX
              y={HEIGHT - MARGIN.bottom}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              ticks={ticks}
            />
            {bars.map(({ lo, hi, count }, i) => (
              <rect
                key={i}
                className={`bar ${hi <= 0 ? 'mark-neg' : 'mark-pos'}`}
                x={x(lo) + 0.5}
                width={Math.max(0, x(hi) - x(lo) - 1)}
                y={y(count)}
                height={y(0) - y(count)}
              >
                <title>{`${single ? f.money(first, currency) : `${f.money(lo, currency)} – ${f.money(hi, currency)}`}: ${f.number(count, 0)}`}</title>
              </rect>
            ))}
            {lo0 < 0 && hi0 > 0 && (
              <g>
                <line
                  className="line-base"
                  x1={x(0)}
                  x2={x(0)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                />
                <text className="note" x={x(0) + 4} y={MARGIN.top + 8}>
                  {t('zero')}
                </text>
              </g>
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
