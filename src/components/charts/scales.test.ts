import { describe, expect, it } from 'vitest';
import { edgeAnchor, tickCount } from './scales';

describe('tickCount', () => {
  it('asks for one tick per 70 px: a 280 px plot gets 4, a 600 px plot gets 8', () => {
    expect(tickCount(280)).toBe(4);
    expect(tickCount(600)).toBe(8);
  });

  it('never asks for fewer than 2, even on a 100 px plot', () => {
    expect(tickCount(100)).toBe(2);
  });
});

describe('edgeAnchor', () => {
  it('starts the label on the first tick, ends it on the last, centres the rest', () => {
    expect(edgeAnchor(56, 56, 624)).toBe('start');
    expect(edgeAnchor(624, 56, 624)).toBe('end');
    expect(edgeAnchor(300, 56, 624)).toBe('middle');
  });
});
