import { useT } from '../../i18n';
import { failureText } from '../../i18n/engineError';
import type { Failure } from '../../i18n/engineError';

export function FailureAlert({
  failure,
  className = 'error',
}: {
  failure: Failure;
  className?: string;
}) {
  const t = useT();
  return (
    <p className={className} role="alert">
      {failureText(t, failure)}
    </p>
  );
}
