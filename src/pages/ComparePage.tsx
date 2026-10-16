import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Analysis, Inputs, McResult } from '../engine/types';
import type { EngineClient } from '../engine/client';
import { sharedEngine } from '../engine/shared';
import { useFormat, useLocale, useT } from '../i18n';
import type { Locale } from '../i18n';
import { failureOf } from '../i18n/engineError';
import type { Failure } from '../i18n/engineError';
import { CumulativeChart } from '../components/compare/CumulativeChart';
import { MetricsTable } from '../components/compare/MetricsTable';
import type { Pair } from '../components/compare/MetricsTable';
import { NpvRange } from '../components/compare/NpvRange';
import { ScenarioSlot } from '../components/compare/ScenarioSlot';
import { InputPanel } from '../components/form/InputPanel';
import { mcErrors } from '../components/form/Simulation';
import type { McSettings } from '../components/form/Simulation';
import { currencyOf } from '../components/results/currency';
import { defaultMc } from '../model/defaults';
import { examples, namedInputs } from '../model/examples';
import type { Localised } from '../model/profiles';
import { decode, encode } from '../model/urlState';
import { isValid } from '../model/validate';
import { parseHash } from '../route';
import { AUTO_SIMULATE_MAX } from './useResults';

interface Slot {
  label: Localised | null;
  inputs: Inputs;
}

// A calculation outcome: the value, the failure, or undefined while it runs.
type Outcome<T> = { value: T } | { failure: Failure } | undefined;

const LETTERS = ['A', 'B'] as const;
const CALCULATION_DELAY_MS = 300;
const URL_DELAY_MS = 500;

function example(id: string, locale: Locale): Slot {
  const found = examples.find((candidate) => candidate.id === id) ?? examples[0];
  if (!found) throw new Error('model/examples.ts has no examples');
  return { label: found.label, inputs: namedInputs(found, locale) };
}

// The simulation settings are shared by both scenarios and travel in the first payload that carries them.
function slotsFromLink(locale: Locale): { slots: Pair<Slot>; mc: McSettings; badLink: boolean } {
  const { query } = parseHash(window.location.hash);
  let badLink = false;
  let mc: McSettings | undefined;
  const slot = (key: 'a' | 'b', fallback: string): Slot => {
    const text = query.get(key);
    if (text === null) return example(fallback, locale);
    const decoded = decode(text);
    if ('error' in decoded) {
      badLink = true;
      return example(fallback, locale);
    }
    mc ??= decoded.mc;
    return { label: null, inputs: decoded.inputs };
  };
  const slots: Pair<Slot> = [slot('a', 'madrid'), slot('b', 'valencia')];
  return { slots, mc: mc ?? defaultMc, badLink };
}

// The a and b payloads of an address, or null when it carries neither.
function linkOfHash(hash: string): string | null {
  const { query } = parseHash(hash);
  if (!query.has('a') && !query.has('b')) return null;
  return `a=${query.get('a') ?? ''}&b=${query.get('b') ?? ''}`;
}

function valuesOf<T>([first, second]: Pair<Outcome<T>>): Pair<T> | null {
  return first && 'value' in first && second && 'value' in second
    ? [first.value, second.value]
    : null;
}

// The client keeps one request per operation, so a calculation of outdated inputs must not start another call:
// it would replace the request of the calculation that took over. `outdated` is a function so that the check
// after the await is not narrowed to the value it had before it.
async function settle<T>(
  call: () => Promise<T>,
  set: Dispatch<SetStateAction<Pair<Outcome<T>>>>,
  side: 0 | 1,
  outdated: () => boolean,
) {
  if (outdated()) return;
  let outcome: Outcome<T>;
  try {
    outcome = { value: await call() };
  } catch (error) {
    const failure = failureOf(error);
    if (!failure) return;
    outcome = { failure };
  }
  if (!outdated()) set((now) => (side === 0 ? [outcome, now[1]] : [now[0], outcome]));
}

export function ComparePage({ client = sharedEngine() }: { client?: EngineClient }) {
  const t = useT();
  const { number } = useFormat();
  const { locale } = useLocale();
  const [start] = useState(() => slotsFromLink(locale));
  const [slots, setSlots] = useState<Pair<Slot>>(start.slots);
  const [mc, setMc] = useState(start.mc);
  const [badLink, setBadLink] = useState(start.badLink);
  const [editing, setEditing] = useState<0 | 1 | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const editButtons = useRef<Pair<HTMLButtonElement | null>>([null, null]);
  const [analyses, setAnalyses] = useState<Pair<Outcome<Analysis>>>([undefined, undefined]);
  const [risks, setRisks] = useState<Pair<Outcome<McResult>>>([undefined, undefined]);
  const [requested, setRequested] = useState<{ a: Inputs; b: Inputs; mc: McSettings } | null>(null);

  const [a, b] = slots;
  const validA = useMemo(() => isValid(a.inputs), [a.inputs]);
  const validB = useMemo(() => isValid(b.inputs), [b.inputs]);
  const valid: Pair<boolean> = [validA, validB];
  const mcValid = useMemo(() => Object.keys(mcErrors(mc)).length === 0, [mc]);
  // Above AUTO_SIMULATE_MAX scenarios the simulation runs only for the inputs and settings the person asked for.
  const asked = requested?.a === a.inputs && requested.b === b.inputs && requested.mc === mc;
  const simulate = mcValid && (mc.n <= AUTO_SIMULATE_MAX || asked);

  // A keyboard user who presses Edit lands in the drawer instead of tabbing through the page to find it.
  useEffect(() => {
    if (editing !== null) drawerRef.current?.focus();
  }, [editing]);

  function closeDrawer() {
    if (editing === null) return;
    setEditing(null);
    editButtons.current[editing]?.focus();
  }

  useEffect(() => {
    let stale = false;
    const outdated = () => stale;
    const timer = setTimeout(() => {
      void (async () => {
        if (validA) await settle(() => client.analyze(a.inputs), setAnalyses, 0, outdated);
        if (validB) await settle(() => client.analyze(b.inputs), setAnalyses, 1, outdated);
      })();
    }, CALCULATION_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [client, a.inputs, b.inputs, validA, validB]);

  useEffect(() => {
    if (!simulate) return;
    let stale = false;
    const outdated = () => stale;
    const { params, n, seed } = mc;
    const timer = setTimeout(() => {
      void (async () => {
        if (validA) {
          await settle(() => client.simulate(a.inputs, params, n, seed), setRisks, 0, outdated);
        }
        if (validB) {
          await settle(() => client.simulate(b.inputs, params, n, seed), setRisks, 1, outdated);
        }
      })();
    }, CALCULATION_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [client, a.inputs, b.inputs, validA, validB, mc, simulate]);

  // The address always names the scenarios on screen. The last pair written is remembered so that only a link
  // the person pasted or followed (a hashchange to another pair) reloads the page.
  const [mountLink] = useState(() => linkOfHash(window.location.hash));
  const written = useRef(mountLink);
  const linkNow = useRef<string | null>(null);
  const writeLink = (text: string) => {
    written.current = text;
    window.history.replaceState(null, '', `#/compare?${text}`);
  };
  const link = useMemo(
    () => (validA && validB && mcValid ? `a=${encode(a.inputs, mc)}&b=${encode(b.inputs)}` : null),
    [a.inputs, b.inputs, validA, validB, mc, mcValid],
  );
  useEffect(() => {
    linkNow.current = link;
    if (link === null) return;
    const timer = setTimeout(() => {
      writeLink(link);
    }, URL_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [link]);
  useEffect(() => {
    const onHashChange = () => {
      const { route } = parseHash(window.location.hash);
      if (route !== 'compare') return;
      const pasted = linkOfHash(window.location.hash);
      if (pasted === null) {
        // The Compare link of the toolbar: the page keeps what it shows, and the address says so again.
        if (linkNow.current !== null) writeLink(linkNow.current);
        return;
      }
      if (pasted === written.current) return;
      const next = slotsFromLink(locale);
      written.current = pasted;
      setAnalyses([undefined, undefined]);
      setRisks([undefined, undefined]);
      setEditing(null);
      setSlots(next.slots);
      setMc(next.mc);
      setBadLink(next.badLink);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [locale]);

  // Figures of the old inputs are dropped at the edit, so a stale number is never read as the new one.
  const forgetRisks = () => {
    setRisks([undefined, undefined]);
  };

  function setSlot(side: 0 | 1, slot: Slot) {
    setAnalyses([undefined, undefined]);
    forgetRisks();
    setSlots((now) => (side === 0 ? [slot, now[1]] : [now[0], slot]));
  }

  const labelOf = (side: 0 | 1) =>
    slots[side].label?.[locale] ??
    slots[side].inputs.name ??
    t('compare.slot', { letter: LETTERS[side] });
  const labels: Pair<string> = [labelOf(0), labelOf(1)];
  const inputs: Pair<Inputs> = [a.inputs, b.inputs];
  const currencies: Pair<string> = [currencyOf(a.inputs), currencyOf(b.inputs)];
  const settled = valuesOf(analyses);
  const simulated = valuesOf(risks);
  const drawn = editing === null ? null : slots[editing];

  return (
    <div className="compare-page">
      <h2>{t('nav.compare')}</h2>
      {badLink && <p role="status">{t('compare.badLink')}</p>}
      <div className="compare-slots">
        {([0, 1] as const).map((side) => {
          const outcome = analyses[side];
          return (
            <ScenarioSlot
              key={side}
              letter={LETTERS[side]}
              label={labels[side]}
              failure={outcome && 'failure' in outcome ? outcome.failure : undefined}
              invalid={!valid[side]}
              waiting={outcome === undefined && valid[side]}
              onLoad={(label, loaded) => {
                setSlot(side, { label, inputs: loaded });
              }}
              editRef={(button) => {
                editButtons.current[side] = button;
              }}
              onEdit={() => {
                setEditing(side);
              }}
            />
          );
        })}
      </div>
      {settled && (
        <>
          <MetricsTable labels={labels} inputs={inputs} analyses={settled} />
          {currencies[0] === currencies[1] && (
            <CumulativeChart
              labels={labels}
              cumulative={[settled[0].cumulative, settled[1].cumulative]}
              currency={currencies[0]}
            />
          )}
        </>
      )}
      {mc.n > AUTO_SIMULATE_MAX && !simulated && (
        <>
          <button
            type="button"
            disabled={!mcValid || !validA || !validB}
            onClick={() => {
              setRequested({ a: a.inputs, b: b.inputs, mc });
            }}
          >
            {Number.isFinite(mc.n)
              ? t('results.runSimulation', { n: number(mc.n, 0) })
              : t('results.runSimulationPlain')}
          </button>
          <p className="compare-note">{t('results.noSimulation')}</p>
        </>
      )}
      {simulated && <NpvRange labels={labels} risks={simulated} currencies={currencies} n={mc.n} />}
      {editing !== null && drawn !== null && (
        <aside
          ref={drawerRef}
          className="compare-drawer"
          role="dialog"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeDrawer();
          }}
          aria-label={t('compare.drawer', { letter: LETTERS[editing] })}
        >
          <button type="button" onClick={closeDrawer}>
            {t('compare.close')}
          </button>
          <p className="compare-note">{t('compare.mcShared')}</p>
          <InputPanel
            inputs={drawn.inputs}
            mc={mc}
            onInputs={(next) => {
              setSlot(editing, {
                label: next.name === drawn.inputs.name ? drawn.label : null,
                inputs: next,
              });
            }}
            onMc={(next) => {
              forgetRisks();
              setMc(next);
            }}
          />
        </aside>
      )}
    </div>
  );
}
