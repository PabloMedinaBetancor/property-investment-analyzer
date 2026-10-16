import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

type BenchKey = MessageKey extends infer K ? (K extends `bench.${infer R}` ? R : never) : never;

// The benchmark strings live in the one translation table under «bench.».
export function useBenchT(): (key: BenchKey, vars?: Record<string, string | number>) => string {
  const t = useT();
  return (key, vars) => t(`bench.${key}`, vars);
}
