import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { EngineError } from '../engine/client';
import type { Locale } from './format';
import { translate } from './index';
import { failureOf, failureText } from './engineError';
import type { Failure } from './engineError';

const text = (locale: Locale, failure: Failure) =>
  failureText((key, vars) => translate(locale, key, vars), failure);

let log: MockInstance<typeof console.error>;

beforeEach(() => {
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
});

describe('the text of an engine failure', () => {
  const cases: [Failure, string, string][] = [
    [
      { code: 'out_of_range', field: 'loan.fixed_rate' },
      '“Fixed interest rate” is outside the range the calculation accepts.',
      '«Tipo de interés fijo» está fuera del rango que admite el cálculo.',
    ],
    [
      { code: 'not_finite', field: 'price' },
      '“Purchase price” is not a finite number.',
      '«Precio de compra» no es un número finito.',
    ],
    [
      { code: 'not_finite', field: 'result' },
      'These inputs give a result that is not a finite number. Try less extreme values.',
      'Estos datos dan un resultado que no es un número finito. Prueba con valores menos extremos.',
    ],
    [
      { code: 'missing_field', field: 'rent_month' },
      '“Monthly rent” is missing.',
      'Falta «Renta mensual».',
    ],
    [
      { code: 'invalid_json', field: '' },
      'The inputs could not be read. Reload the page or load an example.',
      'No se han podido leer los datos. Recarga la página o carga un ejemplo.',
    ],
    [
      { code: 'unknown_region', field: 'region' },
      'This region is not in the list.',
      'Esta comunidad no está en la lista.',
    ],
    [
      { code: 'missing_field', field: 'tax.offset_other_income' },
      '“Losses offset other income” is missing.',
      'Falta «Las pérdidas compensan otras rentas».',
    ],
    [
      { code: 'missing_field', field: 'tax.interest_deductible' },
      '“Interest is deductible” is missing.',
      'Falta «Los intereses son deducibles».',
    ],
    [
      { code: 'missing_field', field: 'tax.offset_losses' },
      '“Losses offset other income” is missing.',
      'Falta «Las pérdidas compensan otras rentas».',
    ],
    [
      { code: 'bad_correlation', field: 'params.corr' },
      'The correlations must form a valid matrix: symmetric, each between -1 and 1, and consistent with each other.',
      'Las correlaciones deben formar una matriz válida: simétrica, cada una entre -1 y 1 y coherentes entre sí.',
    ],
    [
      { code: 'too_many_scenarios', field: 'n' },
      'Use at most 100,000 scenarios.',
      'Usa como máximo 100.000 escenarios.',
    ],
    [
      { code: 'worker_failed', field: '' },
      'The calculation could not run; reload the page.',
      'No se ha podido hacer el cálculo; recarga la página.',
    ],
  ];

  it.each(cases)('%j reads the same in English and in Spanish', (failure, english, spanish) => {
    expect(text('en', failure)).toBe(english);
    expect(text('es', failure)).toBe(spanish);
  });

  it('names an element of the index path by the field of the path', () => {
    expect(text('en', { code: 'out_of_range', field: 'loan.index_path[3]' })).toBe(
      '“Index by year (optional)” is outside the range the calculation accepts.',
    );
  });

  it('shows a path the form does not know as the engine wrote it', () => {
    expect(text('en', { code: 'missing_field', field: 'tax.carry' })).toBe(
      '“tax.carry” is missing.',
    );
  });
});

describe('failureOf', () => {
  it('keeps the code and the field and sends the engine text to the console', () => {
    const error = new EngineError('out_of_range', 'price', 'must be between 0 and 1e9, got -1');
    expect(failureOf(error)).toEqual({ code: 'out_of_range', field: 'price' });
    expect(log).toHaveBeenCalledWith(error);
  });

  it('has nothing to show for a superseded call', () => {
    expect(failureOf(new EngineError('superseded', '', 'replaced'))).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('reads any other exception as a calculation that could not run', () => {
    expect(failureOf(new TypeError('x is not a function'))).toEqual({
      code: 'worker_failed',
      field: '',
    });
  });
});
