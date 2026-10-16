import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures';
import { Rng } from './rng';

interface PrngFixture {
  first_u32: number[];
  first_uniforms: number[];
  first_normals: number[];
  seed_0_first_u32: number[];
}

const prng = fixture('prng') as PrngFixture;

describe('Rng', () => {
  it('seed 42 gives the reference stream: 2837322924, 544945897, 479756282, …', () => {
    const rng = new Rng(42);
    expect(prng.first_u32.map(() => rng.nextU32())).toEqual(prng.first_u32);
  });

  it('seed 0 starts with 3809008728', () => {
    expect(new Rng(0).nextU32()).toBe(3809008728);
    expect(prng.seed_0_first_u32).toEqual([3809008728]);
  });

  it('builds 53-bit uniforms from two outputs, bit for bit', () => {
    const rng = new Rng(42);
    expect(prng.first_uniforms.map(() => rng.uniform())).toEqual(prng.first_uniforms);
  });

  it('draws Box–Muller pairs cosine first, then sine', () => {
    const rng = new Rng(42);
    const drawn = [rng.normalPair(), rng.second, rng.normalPair(), rng.second];
    drawn.forEach((value, i) => {
      expect(value).toBeCloseTo(prng.first_normals[i] as number, 14);
    });
  });

  it('accepts the largest u32 seed', () => {
    expect(new Rng(4294967295).nextU32()).toBeGreaterThanOrEqual(0);
  });
});
