import { describe, expect, it } from 'vitest';
import { parseHash } from './route';

describe('parseHash', () => {
  it('an empty hash is the analyzer', () => {
    expect(parseHash('').route).toBe('analyze');
    expect(parseHash('#/').route).toBe('analyze');
  });

  it('#/compare?a=1.x&b=1.y is the compare page with both payloads', () => {
    const { route, query } = parseHash('#/compare?a=1.x&b=1.y');
    expect(route).toBe('compare');
    expect(query.get('a')).toBe('1.x');
    expect(query.get('b')).toBe('1.y');
  });

  it('#/benchmark is the benchmark page', () => {
    expect(parseHash('#/benchmark').route).toBe('benchmark');
  });

  it('an unknown path falls back to the analyzer', () => {
    expect(parseHash('#/nowhere').route).toBe('analyze');
  });
});
