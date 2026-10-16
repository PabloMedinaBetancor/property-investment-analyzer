import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import type { Messages } from './en';
import { es } from './es';
import { LocaleProvider, translate, useFormat, useLocale, useT } from './index';

describe('catalogues', () => {
  it('a key missing from the Spanish messages is a compile error', () => {
    const withoutTitle: Omit<Messages, 'app.title'> = es;
    // @ts-expect-error Messages requires every key of en
    const incomplete: Messages = withoutTitle;
    expect(incomplete['app.title']).toBe(es['app.title']);
  });

  it('English and Spanish have the same keys and the same placeholders', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort();
    for (const key of Object.keys(en) as (keyof Messages)[]) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('the page title', () => {
  it('follows the language', () => {
    function Switch() {
      const { setLocale } = useLocale();
      return (
        <button
          type="button"
          onClick={() => {
            setLocale('en');
          }}
        >
          English
        </button>
      );
    }
    render(
      <LocaleProvider initial="es">
        <Switch />
      </LocaleProvider>,
    );
    expect(document.title).toBe('Analizador de inversión inmobiliaria');
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(document.title).toBe('Property Investment Analyzer');
  });
});

describe('translate', () => {
  it('fills a placeholder', () => {
    expect(translate('en', 'footer.disclaimer', { date: '2026-10' })).toBe(
      'Not financial or tax advice. Taxes simplified; Spanish rates as of 2026-10.',
    );
  });

  it('leaves a placeholder without a value visible', () => {
    expect(translate('es', 'footer.disclaimer')).toContain('{date}');
  });
});

describe('hooks', () => {
  function Probe() {
    const t = useT();
    const f = useFormat();
    return (
      <p>
        {t('term.npv')} {f.percent(0.0427, 2)}
      </p>
    );
  }

  it('useT and useFormat follow the provider’s locale', () => {
    render(
      <LocaleProvider initial="es">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('VAN 4,27 %')).toBeInTheDocument();
  });
});
