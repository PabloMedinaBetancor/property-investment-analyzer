import { scaleLinear } from 'd3-scale';
import type { IrrPoint, McResult } from '../../engine/types';
import { useFormat } from '../../i18n';
import { ChartFrame } from './ChartFrame';
import { edgeAnchor } from './scales';
import { useChartT } from './useChartT';

const ROW = 56;
const LEFT = 56;
const RIGHT = 24;

interface Point {
  value: number;
  text: string;
}

export function PercentileStrip({ mc, currency }: { mc: McResult; currency: string }) {
  const t = useChartT();
  const f = useFormat();
  const neg = f.percent(mc.p_npv_negative, 1);

  const irrPoints = (irr: [IrrPoint, IrrPoint, IrrPoint]): Point[] => {
    const finite = irr.filter((p): p is number => typeof p === 'number');
    const lo = finite.length ? Math.min(...finite) : 0;
    const hi = finite.length ? Math.max(...finite) : 0;
    const reach = Math.max(hi - lo, 0.02);
    return irr.map((p) =>
      p === 'below'
        ? { value: lo - reach * 0.3, text: t('irrBelow') }
        : p === 'above'
          ? { value: hi + reach * 0.3, text: t('irrAbove') }
          : { value: p, text: f.percent(p, 1) },
    );
  };
  const npvPoints: Point[] = mc.npv_p.map((v) => ({ value: v, text: f.money(v, currency) }));
  const rows = [
    { name: t('irrRow'), points: mc.irr_p ? irrPoints(mc.irr_p) : null },
    { name: t('npvRow'), points: npvPoints },
  ];
  const names = [t('p10'), t('p50'), t('p90')];
  const excluded = t('excluded', {
    multiple: f.number(mc.irr_multiple_count, 0),
    bottom: f.number(mc.irr_bottom_count, 0),
    top: f.number(mc.irr_top_count, 0),
  });

  return (
    <ChartFrame
      caption={t('stripCaption', { neg })}
      label={t('stripLabel', { neg })}
      height={rows.length * ROW}
      note={
        <>
          <strong>{`${t('pNegative')}: ${neg}.`}</strong> {excluded}
        </>
      }
      table={{
        head: [t('variable'), t('p10'), t('p50'), t('p90')],
        rows: [
          [t('irrRow'), ...(rows[0]?.points?.map((p) => p.text) ?? [t('irrNone'), '', ''])],
          [t('npvRow'), ...npvPoints.map((p) => p.text)],
          [t('pNegative'), neg, '', ''],
        ],
      }}
    >
      {(width) => (
        <>
          {rows.map((row, r) => {
            const top = r * ROW;
            const mid = top + 30;
            if (!row.points) {
              return (
                <g key={row.name}>
                  <text className="label" x={0} y={mid} dy="0.32em">
                    {row.name}
                  </text>
                  <text className="note" x={LEFT} y={mid} dy="0.32em">
                    {t('irrNone')}
                  </text>
                </g>
              );
            }
            const values = row.points.map((p) => p.value);
            const lo = Math.min(...values);
            const x0 = LEFT + 40;
            const x1 = width - RIGHT - 40;
            const scale = scaleLinear()
              .domain([lo, Math.max(...values, lo + 1e-9)])
              .range([x0, x1]);
            // With no spread the three points are one: the middle of the strip.
            const x = (v: number) => (Math.max(...values) > lo ? scale(v) : (x0 + x1) / 2);
            // Points that print the same value are one mark carrying all their names.
            const marks = row.points.reduce<{ names: string[]; point: Point; median: boolean }[]>(
              (all, p, i) => {
                const last = all[all.length - 1];
                const name = names[i] ?? '';
                if (last && last.point.text === p.text) {
                  last.names.push(name);
                  last.median ||= i === 1;
                } else all.push({ names: [name], point: p, median: i === 1 });
                return all;
              },
              [],
            );
            return (
              <g key={row.name}>
                <text className="label" x={0} y={mid} dy="0.32em">
                  {row.name}
                </text>
                <line
                  className="axis-line"
                  x1={x(values[0] ?? 0)}
                  x2={x(values[2] ?? 0)}
                  y1={mid}
                  y2={mid}
                />
                {marks.map(({ names: group, point: p, median }) => {
                  const name = group.join(' · ');
                  const anchor = group.length > 1 ? edgeAnchor(x(p.value), x0, x1) : 'middle';
                  return (
                    <g key={name}>
                      <circle
                        className={median ? 'mark-pos' : 'dot'}
                        cx={x(p.value)}
                        cy={mid}
                        r={median ? 6 : 4.5}
                      >
                        <title>{`${name}: ${p.text}`}</title>
                      </circle>
                      <text className="tick" x={x(p.value)} y={mid - 14} textAnchor={anchor}>
                        {name}
                      </text>
                      <text className="label" x={x(p.value)} y={mid + 20} textAnchor={anchor}>
                        {p.text}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </>
      )}
    </ChartFrame>
  );
}
