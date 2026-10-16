import { useEffect, useMemo, useRef, useState } from 'react';
import { CashFlowChart } from '../components/charts/CashFlowChart';
import { McBandChart } from '../components/charts/McBandChart';
import { NpvHistogram } from '../components/charts/NpvHistogram';
import { PercentileStrip } from '../components/charts/PercentileStrip';
import { TornadoChart } from '../components/charts/TornadoChart';
import { InputPanel } from '../components/form/InputPanel';
import { mcErrors } from '../components/form/Simulation';
import type { McSettings } from '../components/form/Simulation';
import { AcquisitionTable } from '../components/results/AcquisitionTable';
import { AmortisationTable } from '../components/results/AmortisationTable';
import { CashFlowTable } from '../components/results/CashFlowTable';
import { currencyOf } from '../components/results/currency';
import { FailureAlert } from '../components/results/FailureAlert';
import { Summary } from '../components/results/Summary';
import type { EngineClient } from '../engine/client';
import { sharedEngine } from '../engine/shared';
import type { Inputs } from '../engine/types';
import { useFormat, useLocale, useT } from '../i18n';
import type { Locale } from '../i18n';
import { defaultMc } from '../model/defaults';
import { examples, namedInputs } from '../model/examples';
import { ratesAsOf } from '../model/profiles';
import { decode, encode } from '../model/urlState';
import { isValid } from '../model/validate';
import { parseHash } from '../route';
import type { Tab } from './Tabs';
import { Tabs } from './Tabs';
import { Toolbar } from './Toolbar';
import { useDebounced } from './useDebounced';
import { SkipLink } from '../components/SkipLink';
import { useResults } from './useResults';

const URL_DELAY_MS = 500;
const SOURCE_URL = 'https://github.com/PabloMedinaBetancor/property-investment-analyzer';

const startingExample = (locale: Locale): Inputs =>
  namedInputs(examples[0] as (typeof examples)[number], locale);

interface Scenario {
  inputs: Inputs;
  mc: McSettings;
  broken: boolean;
}

// The scenario in the address when the page opens: a broken link falls back to the example, with a notice.
function scenarioFromHash(hash: string, locale: Locale): Scenario {
  const text = parseHash(hash).query.get('s');
  const example = { inputs: startingExample(locale), mc: defaultMc };
  if (text === null) return { ...example, broken: false };
  const decoded = decode(text);
  return 'inputs' in decoded
    ? { inputs: decoded.inputs, mc: decoded.mc ?? defaultMc, broken: false }
    : { ...example, broken: true };
}

export function AnalyzePage({ engine }: { engine?: EngineClient }) {
  const t = useT();
  const f = useFormat();
  const { locale } = useLocale();
  const client = useMemo(() => engine ?? sharedEngine(), [engine]);
  const [start] = useState(() => scenarioFromHash(window.location.hash, locale));
  const [inputs, setInputs] = useState(start.inputs);
  const [broken, setBroken] = useState(start.broken);
  const [mc, setMc] = useState(start.mc);
  const valid = useMemo(() => isValid(inputs), [inputs]);
  const mcValid = useMemo(() => Object.keys(mcErrors(mc)).length === 0, [mc]);
  const {
    analysis,
    sensitivity,
    simulation,
    simulatedN,
    errors,
    simulating,
    simulationStale,
    runSimulation,
    auto,
  } = useResults(client, inputs, mc);
  // Figures that no longer answer the inputs on screen: they stay visible, dimmed, with a sentence saying so.
  const earlier = !valid || errors.analysis !== null;

  // replaceState keeps the history clean; the last address written is remembered so that only a link
  // pasted by the person (a hashchange to another scenario) reloads the form.
  const written = useRef<string | null>(null);
  const settled = useDebounced(inputs, URL_DELAY_MS);
  const settledMc = useDebounced(mc, URL_DELAY_MS);
  useEffect(() => {
    if (!isValid(settled) || Object.keys(mcErrors(settledMc)).length > 0) return;
    written.current = encode(settled, settledMc);
    window.history.replaceState(null, '', `#/?s=${written.current}`);
  }, [settled, settledMc]);
  useEffect(() => {
    const onHashChange = () => {
      const text = parseHash(window.location.hash).query.get('s');
      if (text === null || text === written.current) return;
      const next = scenarioFromHash(window.location.hash, locale);
      setInputs(next.inputs);
      setMc(next.mc);
      setBroken(next.broken);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [locale]);

  const currency = currencyOf(inputs);
  const tabs: Tab[] = analysis
    ? [
        {
          id: 'summary',
          label: t('tab.summary'),
          content: (
            <>
              <Summary inputs={inputs} analysis={analysis} />
              <AcquisitionTable inputs={inputs} analysis={analysis} />
            </>
          ),
        },
        {
          id: 'cashflow',
          label: t('tab.cashFlow'),
          content: (
            <>
              <CashFlowChart analysis={analysis} currency={currency} />
              <CashFlowTable inputs={inputs} analysis={analysis} />
            </>
          ),
        },
        {
          id: 'loan',
          label: t('tab.loan'),
          content: <AmortisationTable inputs={inputs} analysis={analysis} />,
        },
        {
          id: 'risk',
          label: t('tab.risk'),
          content: (
            <>
              {!auto && (
                <button
                  type="button"
                  aria-disabled={!mcValid || simulating}
                  onClick={() => {
                    if (mcValid && !simulating) runSimulation();
                  }}
                >
                  {Number.isFinite(mc.n)
                    ? t('results.runSimulation', { n: f.number(mc.n, 0) })
                    : t('results.runSimulationPlain')}
                </button>
              )}
              <p role="status" className="visually-hidden">
                {simulating
                  ? t('results.calculating')
                  : simulation
                    ? t('results.simulationDone')
                    : ''}
              </p>
              {errors.simulation && <FailureAlert failure={errors.simulation} />}
              {simulationStale && !simulating && simulation && (
                <p className="muted">{t('results.simulationEarlier')}</p>
              )}
              {simulation ? (
                <div
                  className={simulationStale || errors.simulation ? 'results-earlier' : undefined}
                >
                  <PercentileStrip mc={simulation} currency={currency} />
                  <McBandChart
                    mc={simulation}
                    n={simulatedN ?? mc.n}
                    base={analysis.cumulative}
                    currency={currency}
                  />
                  <NpvHistogram mc={simulation} currency={currency} />
                </div>
              ) : (
                !errors.simulation && (
                  <p className="muted">
                    {t(simulating ? 'results.calculating' : 'results.noSimulation')}
                  </p>
                )
              )}
            </>
          ),
        },
        {
          id: 'sensitivity',
          label: t('tab.sensitivity'),
          content: errors.sensitivity ? (
            <FailureAlert failure={errors.sensitivity} />
          ) : sensitivity ? (
            <TornadoChart sensitivity={sensitivity} currency={currency} />
          ) : (
            <p className="muted">{t('results.calculating')}</p>
          ),
        },
      ]
    : [];

  return (
    <div className="analyze">
      <h2 className="visually-hidden">{t('nav.analyze')}</h2>
      <Toolbar inputs={inputs} mc={mc} onLoad={setInputs} />
      {broken && (
        <p className="notice" role="status">
          {t('notice.badLink')}
        </p>
      )}
      <div className="analyze-grid">
        <section id="inputs" tabIndex={-1} aria-label={t('form.title')} className="analyze-inputs">
          <InputPanel inputs={inputs} mc={mc} onInputs={setInputs} onMc={setMc} />
        </section>
        <section
          id="results"
          tabIndex={-1}
          aria-label={t('results.title')}
          className="analyze-results"
          aria-busy={!analysis}
        >
          <SkipLink target="inputs" label={t('skip.inputs')} />
          {!valid && <p className="notice">{t('results.fixFields')}</p>}
          {errors.analysis && <FailureAlert failure={errors.analysis} />}
          {analysis ? (
            <>
              {earlier && <p className="muted">{t('results.earlierInputs')}</p>}
              <div className={earlier ? 'results-earlier' : undefined}>
                <Tabs tabs={tabs} label={t('results.title')} />
              </div>
            </>
          ) : (
            valid && <p className="muted">{t('results.calculating')}</p>
          )}
        </section>
      </div>
      <footer className="analyze-footer">
        <p>{t('footer.disclaimer', { date: f.date(ratesAsOf) })}</p>
        <a href={SOURCE_URL}>{t('footer.source')}</a>
        <a href="./THIRD-PARTY-LICENSES.txt">{t('footer.licences')}</a>
      </footer>
    </div>
  );
}
