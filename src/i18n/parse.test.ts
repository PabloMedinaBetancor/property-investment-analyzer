import { describe, expect, it } from 'vitest';
import { parseNumber } from './parse';

describe('parseNumber', () => {
  it.each([
    ['1.234,5', 'es', 1234.5],
    ['1,234.5', 'en', 1234.5],
    ['1234.5', 'en', 1234.5],
    ['1234,5', 'es', 1234.5],
    ['1 234,5', 'es', 1234.5],
    ['1 234,5', 'es', 1234.5],
    ['5 %', 'es', 5],
    ['5%', 'en', 5],
    ['-0,5', 'es', -0.5],
    ['-0.5', 'en', -0.5],
    ['−0,5', 'es', -0.5],
    ['+3', 'en', 3],
    ['0', 'en', 0],
    ['3,2', 'es', 3.2],
    ['3,2', 'en', 3.2],
    ['1.234.567', 'es', 1234567],
    ['1,234,567', 'en', 1234567],
    ['180.000 €', 'es', 180000],
    ['€ 180,000', 'en', 180000],
    ['$320,000', 'en', 320000],
    ['180000 EUR', 'es', 180000],
    ['EUR 180000', 'en', 180000],
    ['-€5', 'en', -5],
    ['€-5', 'en', -5],
    ['%5', 'en', 5],
    ['.5', 'en', 0.5],
    [',5', 'es', 0.5],
    ['.5', 'es', 0.5],
    [',5', 'en', 0.5],
    ['.123', 'es', 0.123],
  ] as const)('parses «%s» in %s as %d', (text, locale, expected) => {
    expect(parseNumber(text, locale)).toBe(expected);
  });

  it('reads a lone «1.234» as a thousands mark in Spanish and as a decimal in English', () => {
    expect(parseNumber('1.234', 'es')).toBe(1234);
    expect(parseNumber('1.234', 'en')).toBe(1.234);
  });

  it('reads «0.123» as a decimal in Spanish too, since no thousands group starts with 0', () => {
    expect(parseNumber('0.123', 'es')).toBe(0.123);
  });

  it.each(['', '   ', 'abc', '-', '%', '1,2,3', '1.2.3,4', '12..5', '1e3', '5 euros', '1,234.5,6'])(
    'rejects «%s»',
    (text) => {
      expect(parseNumber(text, 'es')).toBeNull();
      expect(parseNumber(text, 'en')).toBeNull();
    },
  );
});
