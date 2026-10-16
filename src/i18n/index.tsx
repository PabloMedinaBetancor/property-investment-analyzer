import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import type { MessageKey, Messages } from './en';
import { es } from './es';
import * as format from './format';
import type { Locale } from './format';

export type { Locale, MessageKey };

type Vars = Record<string, string | number>;

const CATALOGUES: Record<Locale, Messages> = { en, es };

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState | null>(null);

function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

interface ProviderProps {
  initial?: Locale;
  onChange?: (locale: Locale) => void;
  children: ReactNode;
}

export function LocaleProvider({ initial, onChange, children }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? browserLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'app.title');
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onChange?.(next);
    },
    [onChange],
  );

  const state = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={state}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (!state) throw new Error('useLocale needs a LocaleProvider above it');
  return state;
}

// Placeholders are written {name}; one without a value stays visible in the text.
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const text = CATALOGUES[locale][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

export function useT(): (key: MessageKey, vars?: Vars) => string {
  const { locale } = useLocale();
  return useCallback((key, vars) => translate(locale, key, vars), [locale]);
}

// The formatters of format.ts with the current locale already applied.
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      number: (x: number, digits?: number) => format.number(x, locale, digits),
      money: (x: number, currency: string, digits?: number) =>
        format.money(x, currency, locale, digits),
      percent: (x: number, digits: number) => format.percent(x, digits, locale),
      years: (x: number) => format.years(x, locale),
      date: (iso: string) => format.date(iso, locale),
    }),
    [locale],
  );
}
