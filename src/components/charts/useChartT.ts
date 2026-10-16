import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

export type ChartKey = MessageKey extends infer K
  ? K extends `chart.${infer R}`
    ? R
    : never
  : never;

// The chart strings live in the one translation table under «chart.»; this keeps the short keys at the call sites.
export function useChartT(): (key: ChartKey, vars?: Record<string, string | number>) => string {
  const t = useT();
  return (key, vars) => t(`chart.${key}`, vars);
}
