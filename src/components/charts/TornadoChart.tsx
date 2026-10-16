import { scaleBand, scaleLinear } from 'd3-scale';
import type { Sensitivity, SensitivityBar, SensitivityVariable } from '../../engine/types';
import { useFormat, useLocale } from '../../i18n';
import { AxisX } from './Axis';
import { ChartFrame } from './ChartFrame';
import { useChartT } from './useChartT';
import { compact, tickCount } from './scales';

const ROW = 40;
const TOP = 8;
const AXIS = 28;

export function TornadoChart({
  sensitivity,
  currency,
}: {
  sensitivity: Sensitivity;
  currency: string;
}) {
  const t = useChartT();
  const f = useFormat();
  const { locale } = useLocale();
  const { base, bars } = sensitivity;

  const input = (variable: SensitivityVariable, value: number) => {
    if (variable === 'price' || variable === 'rent') return f.money(value, currency);
    if (variable === 'opex') return `×${f.number(value, 1)}`;
    return f.percent(value, 1);
  };
  const top = bars[0];

  return (
    <ChartFrame
      caption={t('tornadoCaption')}
      label={t('tornadoLabel', {
        base: f.money(base.npv, currency),
        top: top ? t(`v.${top.variable}`) : '',
      })}
      height={bars.length * ROW + TOP + AXIS}
      legend={[
        { label: t('inputLow'), className: 'mark-muted' },
        { label: t('inputHigh'), className: 'mark-pos' },
      ]}
      table={{
        head: [t('variable'), t('lowValue'), t('npvLow'), t('highValue'), t('npvHigh')],
        rows: bars.map((b) => [
          t(`v.${b.variable}`),
          input(b.variable, b.low_value),
          f.money(b.npv_low, currency),
          input(b.variable, b.high_value),
          f.money(b.npv_high, currency),
        ]),
      }}
    >
      {(width) => {
        const narrow = width < 480;
        const LEFT = narrow ? 104 : 168;
        const values = [base.npv, ...bars.flatMap((b) => [b.npv_low, b.npv_high])];
        const x = scaleLinear()
          .domain([Math.min(...values), Math.max(...values)])
          .nice(5)
          .range([LEFT, width - 24]);
        const rows = scaleBand()
          .domain(bars.map((b) => b.variable))
          .range([TOP, TOP + bars.length * ROW])
          .padding(0.3);
        const plotBottom = TOP + bars.length * ROW;
        const lowBar = (b: SensitivityBar, y: number, h: number) => (
          <rect key="low" className="mark-muted" {...segment(b.npv_low)} y={y} height={h} rx={2}>
            <title>{`${t('inputLow')}: ${f.money(b.npv_low, currency)}`}</title>
          </rect>
        );
        const highBar = (b: SensitivityBar, y: number, h: number) => (
          <rect key="high" className="mark-pos" {...segment(b.npv_high)} y={y} height={h} rx={2}>
            <title>{`${t('inputHigh')}: ${f.money(b.npv_high, currency)}`}</title>
          </rect>
        );
        const segment = (npv: number) => ({
          x: Math.min(x(base.npv), x(npv)),
          width: Math.abs(x(npv) - x(base.npv)),
        });
        return (
          <>
            {x.ticks(tickCount(width - 24 - LEFT)).map((v) => (
              <line key={v} className="grid" x1={x(v)} x2={x(v)} y1={TOP} y2={plotBottom} />
            ))}
            <AxisX
              y={plotBottom}
              x0={LEFT}
              x1={width - 24}
              ticks={x
                .ticks(tickCount(width - 24 - LEFT))
                .map((v) => ({ pos: x(v), label: compact(v, locale) }))}
            />
            <line
              className="line-base"
              x1={x(base.npv)}
              x2={x(base.npv)}
              y1={TOP}
              y2={plotBottom}
            />
            {bars.map((b) => {
              const y = rows(b.variable) ?? 0;
              const h = rows.bandwidth();
              return (
                <g key={b.variable}>
                  <text className="label" x={0} y={y + h / 2 - (narrow ? 0 : 5)} dy="0.32em">
                    {t(`v.${b.variable}`)}
                  </text>
                  {!narrow && (
                    <text className="note" x={0} y={y + h / 2 + 9} dy="0.32em">
                      {`${input(b.variable, b.low_value)} → ${input(b.variable, b.high_value)}`}
                    </text>
                  )}
                  {(Math.abs(b.npv_low - base.npv) >= Math.abs(b.npv_high - base.npv)
                    ? [lowBar, highBar]
                    : [highBar, lowBar]
                  ).map((bar) => bar(b, y, h))}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}
