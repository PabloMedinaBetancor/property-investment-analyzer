import { line } from 'd3-shape';
import type { Analysis } from '../../engine/types';
import { useFormat, useLocale } from '../../i18n';
import { AxisX, AxisY } from './Axis';
import { ChartFrame } from './ChartFrame';
import { useChartT } from './useChartT';
import { MARGIN, bandScale, compact, valueScale } from './scales';

const HEIGHT = 320;

export function CashFlowChart({ analysis, currency }: { analysis: Analysis; currency: string }) {
  const t = useChartT();
  const { locale } = useLocale();
  const f = useFormat();
  const { flows, cumulative } = analysis;
  const lastCumulative = cumulative[cumulative.length - 1] ?? 0;
  const years = flows.map((_, i) => String(i));

  return (
    <ChartFrame
      caption={t('cashFlowCaption')}
      label={t('cashFlowLabel', {
        n: flows.length - 1,
        end: f.money(lastCumulative, currency),
      })}
      height={HEIGHT}
      legend={[
        { label: t('cashFlow'), className: 'mark-pos' },
        { label: t('cumulative'), className: 'line-text' },
      ]}
      table={{
        head: [t('year'), t('cashFlow'), t('cumulative')],
        rows: flows.map((flow, i) => [
          String(i),
          f.money(flow, currency),
          f.money(cumulative[i] ?? 0, currency),
        ]),
      }}
    >
      {(width) => {
        const y = valueScale([...flows, ...cumulative], [HEIGHT - MARGIN.bottom, MARGIN.top]);
        const x = bandScale(years, [MARGIN.left, width - MARGIN.right]);
        const centre = (i: number) => (x(String(i)) ?? 0) + x.bandwidth() / 2;
        const path = line<number>()
          .x((_, i) => centre(i))
          .y((v) => y(v))(cumulative);
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
              ticks={years.map((year, i) => ({ pos: centre(i), label: year }))}
            />
            {flows.map((flow, i) => (
              <rect
                key={years[i]}
                className={`bar ${flow < 0 ? 'mark-neg' : 'mark-pos'}`}
                x={x(String(i))}
                width={x.bandwidth()}
                y={Math.min(y(0), y(flow))}
                height={Math.abs(y(flow) - y(0))}
                rx={2}
              >
                <title>{`${t('year')} ${String(i)}: ${f.money(flow, currency)}`}</title>
              </rect>
            ))}
            <path className="line-text" d={path ?? ''} />
            {cumulative.map((v, i) => (
              <circle key={years[i]} className="dot" cx={centre(i)} cy={y(v)} r={3.5}>
                <title>{`${t('cumulative')}, ${t('year')} ${String(i)}: ${f.money(v, currency)}`}</title>
              </circle>
            ))}
          </>
        );
      }}
    </ChartFrame>
  );
}
