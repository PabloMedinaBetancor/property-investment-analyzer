import type { Ref } from 'react';
import type { Inputs } from '../../engine/types';
import { useLocale, useT } from '../../i18n';
import type { Failure } from '../../i18n/engineError';
import { examples, namedInputs } from '../../model/examples';
import { listScenarios } from '../../model/storage';
import { FailureAlert } from '../results/FailureAlert';

interface Props {
  letter: 'A' | 'B';
  label: string;
  failure: Failure | undefined;
  invalid: boolean;
  waiting: boolean;
  onLoad: (label: { en: string; es: string }, inputs: Inputs) => void;
  onEdit: () => void;
  editRef: Ref<HTMLButtonElement>;
}

export function ScenarioSlot({
  letter,
  label,
  failure,
  invalid,
  waiting,
  onLoad,
  onEdit,
  editRef,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const saved = listScenarios();

  function choose(value: string) {
    const [kind, key] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    if (kind === 'example') {
      const found = examples.find((example) => example.id === key);
      if (found) onLoad(found.label, namedInputs(found, locale));
    } else {
      const found = saved.find((scenario) => scenario.name === key);
      if (found) onLoad({ en: found.name, es: found.name }, found.inputs);
    }
  }

  return (
    <div className="compare-slot">
      <h3>
        {t('compare.slot', { letter })}: {label}
      </h3>
      <div className="compare-slot-actions">
        <select
          aria-label={t('compare.loadFor', { letter })}
          value=""
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          <option value="">{t('compare.load')}</option>
          <optgroup label={t('compare.examples')}>
            {examples.map((example) => (
              <option key={example.id} value={`example:${example.id}`}>
                {example.label[locale]}
              </option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label={t('compare.saved')}>
              {saved.map((scenario) => (
                <option key={scenario.name} value={`saved:${scenario.name}`}>
                  {scenario.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button ref={editRef} type="button" onClick={onEdit}>
          {t('compare.edit')}
        </button>
      </div>
      {invalid && <p className="compare-note">{t('results.fixFields')}</p>}
      {failure && <FailureAlert failure={failure} className="compare-error" />}
      {waiting && !failure && <p className="compare-note">{t('compare.calculating')}</p>}
    </div>
  );
}
