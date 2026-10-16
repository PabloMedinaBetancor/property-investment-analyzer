import type { Inputs } from '../../engine/types';

export function currencyOf(inputs: Inputs): string {
  return inputs.currency ?? 'EUR';
}
