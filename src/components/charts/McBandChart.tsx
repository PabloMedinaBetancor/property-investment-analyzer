import { area, line } from 'd3-shape';
import type { McResult } from '../../engine/types';
import { useFormat, useLocale } from '../../i18n';
import { AxisX, AxisY } from './Axis';
import { ChartFrame } from './ChartFrame';
import { useChartT } from './useChartT';
import { MARGIN, compact, valueScale } from './scales';
import { scaleLinear } from 'd3-scale';

const HEIGHT = 320;

interface Props {
  mc: McResult;
  n: number;
  base?: number[];
  currency: string;
}

export function McBandChart({ mc, n, base, currency }: Props) {
  const t = useChartT();
  const { locale } = useLocale();
  const f = useFormat();
  const bands = mc.cum_p_by_year;
  const median = bands[bands.length - 1]?.[1] ?? 0;
  const legend = [
    { label: t('band'), className: 'mark-band' },
    { label: t('p50'), className: 'line-text' },
    ...(base ? [{ label: t('baseCase'), className: 'line-base' }] : []),
  ];

  return (
    <ChartFrame
      caption={t('bandCaption', { n: f.number(n, 0) })}
      label={t('bandLabel', { n: bands.length - 1, end: f.money(median, currency) })}
      height={HEIGHT}
      legend={legend}
      table={{
        head: [t('year'), t('p10'), t('p50'), t('p90')],
        rows: bands.map(([lo, mid, hi], i) => [
          String(i),
          f.money(lo, currency),
          f.money(mid, currency),
          f.money(hi, currency),
        ]),
      }}
    >
      {(width) => {
        const y = valueScale(
          [...bands.flat(), ...(base ?? [])],
          [HEIGHT - MARGIN.bottom, MARGIN.top],
        );
        const x = scaleLinear()
          .domain([0, bands.length - 1])
          .range([MARGIN.left, width - MARGIN.right]);
        const step = Math.max(1, Math.ceil((bands.length - 1) / 10));
        const xTicks = bands.flatMap((_, i) =>
          i % step === 0 ? [{ pos: x(i), label: String(i) }] : [],
        );
        const band = area<[number, number, number]>()
          .x((_, i) => x(i))
          .y0((p) => y(p[0]))
          .y1((p) => y(p[2]))(bands);
        const mid = line<[number, number, number]>()
          .x((_, i) => x(i))
          .y((p) => y(p[1]))(bands);
        const baseline = base
          ? line<number>()
              .x((_, i) => x(i))
              .y((v) => y(v))(base)
          : null;
        return (
          <>
            <AxisY
              scale={y}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              format={(v) => compact(v, locale)}
            />
            <AxisX
              y={HEIGHT - MARGIN.bottom}
              x0={MARGIN.left}
              x1={width - MARGIN.right}
              ticks={xTicks}
            />
            <path className="mark-band band" data-points={bands.length} d={band ?? ''} />
            <path className="line-accent" d={mid ?? ''} />
            {baseline && <path className="line-base" d={baseline} />}
          </>
        );
      }}
    </ChartFrame>
  );
}
