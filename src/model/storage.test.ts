import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultInputs } from './defaults';
import { examples } from './examples';
import {
  deleteScenario,
  getLang,
  listScenarios,
  MAX_SCENARIOS,
  saveScenario,
  setLang,
} from './storage';

const madrid = examples[0]?.inputs ?? defaultInputs();

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('storage', () => {
  it('saves a scenario and lists it newest first', () => {
    saveScenario('first', madrid);
    saveScenario('second', defaultInputs('generic'));
    expect(listScenarios().map((s) => s.name)).toEqual(['second', 'first']);
    expect(listScenarios()[1]?.inputs).toEqual(madrid);
  });

  it('saving under an existing name replaces it', () => {
    saveScenario('flat', madrid);
    saveScenario('flat', defaultInputs());
    expect(listScenarios()).toHaveLength(1);
    expect(listScenarios()[0]?.inputs).toEqual(defaultInputs());
  });

  it('keeps the newest 50 scenarios', () => {
    for (let i = 0; i < 53; i++) saveScenario(`s${i.toString()}`, madrid);
    const names = listScenarios().map((s) => s.name);
    expect(names).toHaveLength(MAX_SCENARIOS);
    expect(names[0]).toBe('s52');
    expect(names.at(-1)).toBe('s3');
  });

  it('says which scenario the 51st save deleted', () => {
    for (let i = 0; i < MAX_SCENARIOS; i++) {
      expect(saveScenario(`s${i.toString()}`, madrid)).toEqual({ saved: true, dropped: null });
    }
    expect(saveScenario('more', madrid)).toEqual({ saved: true, dropped: 's0' });
    expect(saveScenario('more', madrid)).toEqual({ saved: true, dropped: null });
  });

  it('deletes by name', () => {
    saveScenario('a', madrid);
    saveScenario('b', madrid);
    deleteScenario('a');
    expect(listScenarios().map((s) => s.name)).toEqual(['b']);
  });

  it('drops malformed entries and survives broken JSON', () => {
    window.localStorage.setItem('pia.scenarios.v1', JSON.stringify([{ name: 1 }, { name: 'x' }]));
    expect(listScenarios()).toEqual([]);
    window.localStorage.setItem('pia.scenarios.v1', '{oops');
    expect(listScenarios()).toEqual([]);
  });

  it('drops a saved scenario whose inputs carry a name or starting value of the wrong type', () => {
    const entry = (inputs: object) => ({ name: 'x', saved_at: '2026-01-01T00:00:00Z', inputs });
    window.localStorage.setItem(
      'pia.scenarios.v1',
      JSON.stringify([
        entry({ ...madrid, name: {} }),
        entry({ ...madrid, name: 5 }),
        entry({ ...madrid, value0: 'x' }),
        entry({ ...madrid, name: 'Fine', value0: 100000 }),
      ]),
    );
    expect(listScenarios().map((s) => s.inputs.name)).toEqual(['Fine']);
  });

  it('remembers the language and ignores other values', () => {
    expect(getLang()).toBeNull();
    setLang('es');
    expect(getLang()).toBe('es');
    window.localStorage.setItem('pia.lang', 'fr');
    expect(getLang()).toBeNull();
  });

  it('never throws when localStorage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', broken);
    expect(listScenarios()).toEqual([]);
    expect(saveScenario('a', madrid)).toEqual({ saved: false, dropped: null });
    expect(deleteScenario('a')).toBe(false);
    expect(getLang()).toBeNull();
    expect(() => {
      setLang('en');
    }).not.toThrow();
  });
});
