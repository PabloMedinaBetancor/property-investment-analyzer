import { useEffect, useMemo, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Analysis, Inputs, McResult, Sensitivity } from '../engine/types';
import { mcErrors } from '../components/form/Simulation';
import type { McSettings } from '../components/form/Simulation';
import { isValid } from '../model/validate';
import { failureOf } from '../i18n/engineError';
import type { Failure } from '../i18n/engineError';
import { useDebounced } from './useDebounced';

export const DEBOUNCE_MS = 300;
// Up to this many scenarios the simulation reruns on every change; above it, only on request.
export const AUTO_SIMULATE_MAX = 10_000;

interface Request {
  inputs: Inputs;
  mc: McSettings;
}

type Op = 'analysis' | 'sensitivity' | 'simulation';

interface State {
  analysis: Analysis | null;
  sensitivity: Sensitivity | null;
  simulation: McResult | null;
  // The request the shown simulation answers.
  simulatedFor: Request | null;
  errors: Record<Op, Failure | null>;
}

const EMPTY: State = {
  analysis: null,
  sensitivity: null,
  simulation: null,
  simulatedFor: null,
  errors: { analysis: null, sensitivity: null, simulation: null },
};

// Runs the engine 300 ms after the last edit. A reply that arrives after a newer edit is dropped here; the
// client also rejects the call it replaced, and that rejection is not an error to show. Validity is judged on
// the settled values the engine receives, not on the ones being typed, so recovering from an invalid field
// never sends the invalid value that is still settled.
export function useResults(engine: EngineClient, inputs: Inputs, mc: McSettings) {
  const [state, setState] = useState(EMPTY);
  const [onDemand, setOnDemand] = useState<Request | null>(null);
  const settledInputs = useDebounced(inputs, DEBOUNCE_MS);
  const settledMc = useDebounced(mc, DEBOUNCE_MS);
  const settledValid = useMemo(() => isValid(settledInputs), [settledInputs]);
  const auto = settledMc.n <= AUTO_SIMULATE_MAX;
  const request = useMemo<Request | null>(
    () => (auto ? { inputs: settledInputs, mc: settledMc } : onDemand),
    [auto, settledInputs, settledMc, onDemand],
  );

  // What failed was an earlier input; the form already says what is wrong with the one now settled.
  const [wasValid, setWasValid] = useState(settledValid);
  if (wasValid !== settledValid) {
    setWasValid(settledValid);
    if (!settledValid) {
      setState((s) => ({ ...s, errors: { ...s.errors, analysis: null, sensitivity: null } }));
    }
  }

  // A simulation failure belongs to the run that failed; another request, or none, starts without it.
  const [failedRequest, setFailedRequest] = useState(request);
  if (failedRequest !== request) {
    setFailedRequest(request);
    setState((s) => ({ ...s, errors: { ...s.errors, simulation: null } }));
  }

  const requestValid = useMemo(
    () =>
      request !== null && isValid(request.inputs) && Object.keys(mcErrors(request.mc)).length === 0,
    [request],
  );

  useEffect(() => {
    if (!settledValid) return;
    let current = true;
    const succeed = (op: Op, change: Partial<State>) => {
      if (current) setState((s) => ({ ...s, ...change, errors: { ...s.errors, [op]: null } }));
    };
    const fail = (op: Op) => (error: unknown) => {
      const failure = failureOf(error);
      if (current && failure) setState((s) => ({ ...s, errors: { ...s.errors, [op]: failure } }));
    };
    void engine.analyze(settledInputs).then((analysis) => {
      succeed('analysis', { analysis });
    }, fail('analysis'));
    void engine.sensitivity(settledInputs).then((sensitivity) => {
      succeed('sensitivity', { sensitivity });
    }, fail('sensitivity'));
    return () => {
      current = false;
    };
  }, [engine, settledInputs, settledValid]);

  useEffect(() => {
    if (!requestValid || request === null) return;
    let current = true;
    engine.simulate(request.inputs, request.mc.params, request.mc.n, request.mc.seed).then(
      (simulation) => {
        if (current) {
          setState((s) => ({
            ...s,
            simulation,
            simulatedFor: request,
            errors: { ...s.errors, simulation: null },
          }));
        }
      },
      (error: unknown) => {
        const failure = failureOf(error);
        if (current && failure) {
          setState((s) => ({ ...s, errors: { ...s.errors, simulation: failure } }));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [engine, request, requestValid]);

  return {
    analysis: state.analysis,
    sensitivity: state.sensitivity,
    simulation: state.simulation,
    simulatedN: state.simulatedFor?.mc.n ?? null,
    errors: state.errors,
    simulating:
      requestValid &&
      request !== null &&
      state.simulatedFor !== request &&
      state.errors.simulation === null,
    // The shown simulation answers inputs or settings that are no longer the settled ones.
    simulationStale:
      state.simulatedFor !== null &&
      (state.simulatedFor.inputs !== settledInputs || state.simulatedFor.mc !== settledMc),
    auto,
    runSimulation: () => {
      setOnDemand({ inputs, mc });
    },
  };
}
