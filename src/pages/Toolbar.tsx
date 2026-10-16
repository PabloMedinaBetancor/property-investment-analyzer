import { useEffect, useState } from 'react';
import type { Inputs } from '../engine/types';
import { useLocale, useT } from '../i18n';
import { examples, namedInputs } from '../model/examples';
import { deleteScenario, listScenarios, saveScenario } from '../model/storage';
import { encode } from '../model/urlState';
import { mcErrors } from '../components/form/Simulation';
import type { McSettings } from '../components/form/Simulation';
import { isValid } from '../model/validate';

interface Props {
  inputs: Inputs;
  mc: McSettings;
  onLoad: (inputs: Inputs) => void;
}

export function shareLink(inputs: Inputs, mc: McSettings): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/?s=${encode(inputs, mc)}`;
}

type Status =
  'copied' | 'copyFailed' | 'notSaved' | 'savedOk' | 'savedDropped' | 'fixFields' | null;
const STATUS_MS = 6000;

export function Toolbar({ inputs, mc, onLoad }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [saved, setSaved] = useState(listScenarios);
  const [chosen, setChosen] = useState('');
  const [made, setMade] = useState<{ status: Status; inputs: Inputs; mc: McSettings } | null>(null);
  const setStatus = (status: Status) => {
    setMade({ status, inputs, mc });
  };
  // A message about the inputs of a moment ago is wrong once they change.
  const status = made?.inputs === inputs && made.mc === mc ? made.status : null;
  const [dropped, setDropped] = useState('');
  const scenario = saved.find((s) => s.name === chosen);
  const complete = isValid(inputs) && Object.keys(mcErrors(mc)).length === 0;

  // Nor is a message worth keeping for long.
  useEffect(() => {
    if (made === null) return;
    const timer = setTimeout(() => {
      setMade(null);
    }, STATUS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [made]);

  const save = () => {
    if (!complete) {
      setStatus('fixFields');
      return;
    }
    const name = inputs.name?.trim();
    const result = saveScenario(name ? name : t('toolbar.untitled'), inputs);
    setSaved(listScenarios());
    setDropped(result.dropped ?? '');
    setStatus(!result.saved ? 'notSaved' : result.dropped === null ? 'savedOk' : 'savedDropped');
  };

  const copy = () => {
    if (!complete) {
      setStatus('fixFields');
      return;
    }
    navigator.clipboard.writeText(shareLink(inputs, mc)).then(
      () => {
        setStatus('copied');
      },
      () => {
        setStatus('copyFailed');
      },
    );
  };

  return (
    <div className="toolbar" role="group" aria-label={t('toolbar.label')}>
      <label>
        {t('toolbar.example')}
        <select
          value=""
          onChange={(event) => {
            const example = examples.find((e) => e.id === event.target.value);
            if (example) onLoad(namedInputs(example, locale));
          }}
        >
          <option value="">{t('toolbar.choose')}</option>
          {examples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.label[locale]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={save}>
        {t('toolbar.save')}
      </button>
      {saved.length > 0 && (
        <>
          <label>
            {t('toolbar.saved')}
            <select
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
            >
              <option value="">{t('toolbar.choose')}</option>
              {saved.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!scenario}
            onClick={() => {
              if (scenario) onLoad(scenario.inputs);
            }}
          >
            {t('toolbar.load')}
          </button>
          <button
            type="button"
            disabled={!scenario}
            onClick={() => {
              deleteScenario(chosen);
              setSaved(listScenarios());
              setChosen('');
            }}
          >
            {t('toolbar.delete')}
          </button>
        </>
      )}
      <button type="button" onClick={copy}>
        {t('toolbar.copyLink')}
      </button>
      <a href={complete ? `#/compare?a=${encode(inputs, mc)}` : '#/compare'}>
        {t('toolbar.compare')}
      </a>
      <p role="status" className="toolbar-status">
        {status ? t(`toolbar.${status}`, { name: dropped }) : ''}
      </p>
    </div>
  );
}
