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
          .domain([first, last])
          .range([MARGIN.left, width - MARGIN.right]);
        const y = scaleLinear()
          .domain([0, Math.max(...counts, 1)])
          .nice(5)
          .range([HEIGHT - MARGIN.bottom, MARGIN.top]);
        const ticks = x
          .ticks(tickCount(width - MARGIN.left - MARGIN.right))
          .map((v) => ({ pos: x(v), label: compact(v, locale) }));
        return (
          <>
            <AxisY
              scale={y}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              format={(v) => f.number(v, 0)}
            />
            <AxisX
              y={HEIGHT - MARGIN.bottom}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              ticks={ticks}
            />
            {counts.map((count, i) => {
              const lo = edges[i] ?? 0;
              const hi = edges[i + 1] ?? 0;
              return (
                <rect
                  key={lo}
                  className={`bar ${hi <= 0 ? 'mark-neg' : 'mark-pos'}`}
                  x={x(lo) + 0.5}
                  width={Math.max(0, x(hi) - x(lo) - 1)}
                  y={y(count)}
                  height={y(0) - y(count)}
                >
                  <title>{`${f.money(lo, currency)} – ${f.money(hi, currency)}: ${f.number(count, 0)}`}</title>
                </rect>
              );
            })}
            {first < 0 && last > 0 && (
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
