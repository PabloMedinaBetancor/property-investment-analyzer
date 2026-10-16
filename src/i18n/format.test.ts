import { describe, expect, it } from 'vitest';
import { date, money, number, percent, years } from './format';

const NBSP = String.fromCharCode(0xa0);

describe('format', () => {
  it('writes 0.0427 as «4.27 %» in English and «4,27 %» in Spanish', () => {
    expect(percent(0.0427, 2, 'en')).toBe('4.27 %');
    expect(percent(0.0427, 2, 'es')).toBe('4,27 %');
  });

  it('writes a negative percentage with a minus sign', () => {
    expect(percent(-0.005, 1, 'en')).toBe('-0.5 %');
  });

  it('writes 1234567.891 with two decimals using each locale’s marks', () => {
    expect(number(1234567.891, 'en')).toBe('1,234,567.89');
    expect(number(1234567.891, 'es')).toBe('1.234.567,89');
  });

  it('writes whole euros by default and cents on request', () => {
    expect(money(207142, 'EUR', 'en')).toBe('€207,142');
    expect(money(599.55, 'USD', 'en', 2)).toBe('$599.55');
    expect(money(207142, 'EUR', 'es')).toBe('207.142 €');
  });

  it('writes years with the unit in the locale', () => {
    expect(years(10, 'en')).toBe('10 years');
    expect(years(10, 'es')).toBe('10 años');
    expect(years(-0.04, 'en')).toBe('0 years');
    expect(years(-0.4, 'en')).toBe('-0.4 years');
  });

  it('writes the rates date day first: «16 Oct 2026» and «16 oct 2026»', () => {
    expect(date('2026-10-16', 'en')).toBe('16 Oct 2026');
    expect(date('2026-10-16', 'es')).toBe('16 oct 2026');
  });

  it('writes a value that rounds to zero without a minus sign', () => {
    expect(money(-2.2e-11, 'EUR', 'en')).toBe('€0');
    expect(money(-0, 'EUR', 'es')).toBe('0' + NBSP + '€');
    expect(number(-0.004, 'en', 2)).toBe('0.00');
    expect(percent(-1e-9, 2, 'en')).toBe('0.00' + NBSP + '%');
    expect(money(-0.6, 'EUR', 'en')).toBe('-€1');
  });

  it('marks every thousand in Spanish, four digits included', () => {
    expect(money(-1990, 'EUR', 'es')).toBe('-1.990' + NBSP + '€');
    expect(money(8840, 'EUR', 'es')).toBe('8.840' + NBSP + '€');
    expect(number(1234.5, 'es', 2)).toBe('1.234,50');
    expect(money(8840, 'EUR', 'en')).toBe('€8,840');
  });
});
