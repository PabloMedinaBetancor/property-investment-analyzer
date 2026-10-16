import { scaleBand, scaleLinear } from 'd3-scale';
import type { Locale } from '../../i18n';

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const MARGIN: Margin = { top: 12, right: 16, bottom: 28, left: 56 };

export const DEFAULT_WIDTH = 640;

// The value axis always includes zero: bars and cumulative lines are read against it.
export function valueScale(values: number[], range: [number, number], includeZero = true) {
  const lo = Math.min(...values, includeZero ? 0 : Infinity);
  const hi = Math.max(...values, includeZero ? 0 : -Infinity);
  const pad = lo === hi ? 1 : 0;
  return scaleLinear()
    .domain([lo - pad, hi + pad])
    .nice(5)
    .range(range);
}

// One tick per ~70 px keeps labels apart on a phone and gives a wide plot more guides.
export function tickCount(span: number): number {
  return Math.max(2, Math.floor(span / 70));
}

// A label centred on the first or last tick would run past the plot edge.
export function edgeAnchor(pos: number, x0: number, x1: number): 'start' | 'middle' | 'end' {
  if (pos <= x0 + 1) return 'start';
  if (pos >= x1 - 1) return 'end';
  return 'middle';
}

export function bandScale(keys: string[], range: [number, number]) {
  return scaleBand().domain(keys).range(range).paddingInner(0.25).paddingOuter(0.15);
}

// Axis labels in a few characters: 12 k, −1,2 M.
export function compact(x: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(x);
}
