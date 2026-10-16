import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_WIDTH } from './scales';
import { useChartT } from './useChartT';
import './charts.css';

export interface LegendItem {
  label: string;
  className: string;
}

export interface ChartTable {
  head: string[];
  rows: string[][];
}

interface Props {
  caption: string;
  label: string;
  legend?: LegendItem[];
  table: ChartTable;
  height: number;
  note?: ReactNode;
  children: (width: number) => ReactNode;
}

export function ChartFrame({ caption, label, legend, table, height, note, children }: Props) {
  const t = useChartT();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [asTable, setAsTable] = useState(false);
  const region = useId();

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
  }, [asTable]);

  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      {legend && !asTable && (
        <ul className="legend">
          {legend.map((item) => (
            <li key={item.label}>
              <span className={`swatch ${item.className}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <div id={region}>
        {asTable ? (
          <div className="chart-table">
            <table>
              <thead>
                <tr>
                  {table.head.map((h, i) => (
                    // The tables are static: the position is the identity.
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  // Rows may start with the same value (the histogram's bins do when all scenarios agree).
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={box} className="chart-box">
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${String(width)} ${String(height)}`}
              role="img"
              aria-label={label}
            >
              {children(width)}
            </svg>
          </div>
        )}
      </div>
      {note && <p className="chart-note">{note}</p>}
      <button
        type="button"
        className="chart-toggle"
        aria-controls={region}
        onClick={() => {
          setAsTable(!asTable);
        }}
      >
        {asTable ? t('showChart') : t('showTable')}
      </button>
    </figure>
  );
}
