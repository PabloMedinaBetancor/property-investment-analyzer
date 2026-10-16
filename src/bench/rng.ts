const GOLDEN = 0x9e3779b9;

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

function mix(counter: number): number {
  let z = Math.imul(counter ^ (counter >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return z ^ (z >>> 16);
}

// The state stays in int32 so V8 never leaves integer arithmetic; outputs are
// converted to u32 with `>>> 0`.
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  /** The sine half of the last `normalPair`, so a draw allocates nothing. */
  second = 0;

  constructor(seed: number) {
    let counter = seed | 0;
    counter = (counter + GOLDEN) | 0;
    this.s0 = mix(counter);
    counter = (counter + GOLDEN) | 0;
    this.s1 = mix(counter);
    counter = (counter + GOLDEN) | 0;
    this.s2 = mix(counter);
    counter = (counter + GOLDEN) | 0;
    this.s3 = mix(counter);
  }

  nextU32(): number {
    const s1 = this.s1;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  uniform(): number {
    const a = this.nextU32();
    const b = this.nextU32();
    return ((a >>> 5) * 67108864 + (b >>> 6)) / 9007199254740992;
  }

  /** Box–Muller: returns the cosine value and leaves the sine value in `second`. */
  normalPair(): number {
    const u1 = this.uniform();
    const u2 = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(1 - u1));
    const angle = 2 * Math.PI * u2;
    this.second = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }
}
