import { useFormat, useLocale, useT } from '../../i18n';
import type { Irr } from '../../engine/types';

// The range the engine searches; outside it a root is reported as «outside».
const LOW = -0.99;
const HIGH = 10;

export function IrrValue({ irr }: { irr: Irr }) {
  const t = useT();
  const { percent } = useFormat();
  const { locale } = useLocale();

  if (irr.kind === 'Unique') return <span>{percent(irr.rate, 2)}</span>;
  if (irr.kind === 'Multiple') {
    const rates = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
      irr.rates.map((rate) => percent(rate, 1)),
    );
    return <span>{t('irr.several', { rates })}</span>;
  }
  if (irr.reason === 'NoSignChange') return <span>{t('irr.noSignChange')}</span>;
  return <span>{t('irr.outOfRange', { low: percent(LOW, 0), high: percent(HIGH, 0) })}</span>;
}
