import { useFormat } from '../../i18n';

interface Props {
  value: number;
  currency: string;
  // Only figures whose sign is a result (NPV, differences) are coloured; a cost is not good news.
  signed?: boolean;
}

export function Amount({ value, currency, signed = false }: Props) {
  const { money } = useFormat();
  // Zero stays neutral; the minus sign carries the meaning, the colour only helps.
  const sign = !signed || value === 0 ? '' : value < 0 ? 'neg' : 'pos';
  return <span className={sign}>{money(value, currency)}</span>;
}
