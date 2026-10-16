import type { Inputs } from '../engine/types';
import type { Locale } from '../i18n';
import { isInputs } from './urlState';

export interface Scenario {
  name: string;
  saved_at: string;
  inputs: Inputs;
}

const LANG_KEY = 'pia.lang';
const SCENARIOS_KEY = 'pia.scenarios.v1';
export const MAX_SCENARIOS = 50;

// Private windows and blocked site data make any access throw: the app then simply forgets.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function isScenario(value: unknown): value is Scenario {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['name'] === 'string' &&
    typeof entry['saved_at'] === 'string' &&
    isInputs(entry['inputs'])
  );
}

// Newest first.
export function listScenarios(): Scenario[] {
  const text = read(SCENARIOS_KEY);
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isScenario) : [];
  } catch {
    return [];
  }
}

export interface SaveResult {
  saved: boolean;
  // The name of the oldest scenario, deleted to make room.
  dropped: string | null;
}

// A scenario saved under an existing name replaces it. The oldest ones go past MAX_SCENARIOS.
export function saveScenario(name: string, inputs: Inputs): SaveResult {
  const others = listScenarios().filter((s) => s.name !== name);
  const all = [{ name, saved_at: new Date().toISOString(), inputs }, ...others];
  const kept = all.slice(0, MAX_SCENARIOS);
  const saved = write(SCENARIOS_KEY, JSON.stringify(kept));
  return { saved, dropped: saved ? (all[MAX_SCENARIOS]?.name ?? null) : null };
}

export function deleteScenario(name: string): boolean {
  return write(SCENARIOS_KEY, JSON.stringify(listScenarios().filter((s) => s.name !== name)));
}

export function getLang(): Locale | null {
  const value = read(LANG_KEY);
  return value === 'en' || value === 'es' ? value : null;
}

export function setLang(locale: Locale): void {
  write(LANG_KEY, locale);
}
