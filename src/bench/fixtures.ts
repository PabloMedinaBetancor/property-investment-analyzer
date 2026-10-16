import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../tests/fixtures', `${name}.json`), 'utf8'),
  );
}

// The reference's `close`: relative to the larger magnitude, absolute below 1.
export function close(a: number, b: number, tolerance = 1e-9): boolean {
  return a === b || Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}
