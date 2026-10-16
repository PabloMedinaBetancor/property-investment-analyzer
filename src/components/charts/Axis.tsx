import type { ScaleLinear } from 'd3-scale';
import { edgeAnchor } from './scales';

interface XTick {
  pos: number;
  label: string;
}

export function AxisX({ ticks, y, x0, x1 }: { ticks: XTick[]; y: number; x0: number; x1: number }) {
  return (
    <g className="axis" aria-hidden="true">
      <line className="axis-line" x1={x0} x2={x1} y1={y} y2={y} />
      {ticks.map((tick) => (
        <text
          key={tick.label}
          className="tick"
          x={tick.pos}
          y={y + 16}
          textAnchor={edgeAnchor(tick.pos, x0, x1)}
        >
          {tick.label}
        </text>
      ))}
    </g>
  );
}

export function AxisY({
  scale,
  x0,
  x1,
  format,
}: {
  scale: ScaleLinear<number, number>;
  x0: number;
  x1: number;
  format: (x: number) => string;
}) {
  return (
    <g className="axis" aria-hidden="true">
      {scale.ticks(5).map((tick) => (
        <g key={tick}>
          <line
            className={tick === 0 ? 'axis-line' : 'grid'}
            x1={x0}
            x2={x1}
            y1={scale(tick)}
            y2={scale(tick)}
          />
          <text className="tick" x={x0 - 8} y={scale(tick)} dy="0.32em" textAnchor="end">
            {format(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}
