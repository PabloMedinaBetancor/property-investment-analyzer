import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cratePackages, npmPackages, thirdPartyLicenses } from '../tools/licenses.mjs';

// What the build puts in dist/THIRD-PARTY-LICENSES.txt. If a dependency is added, the file must name it.
describe('the third-party licence file', () => {
  const text = thirdPartyLicenses();
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('names every runtime dependency of the page with its licence text', () => {
    for (const name of Object.keys(manifest.dependencies)) {
      expect(npmPackages().map((p) => p.name)).toContain(name);
    }
    for (const p of npmPackages()) {
      expect(text).toContain(`${p.name} ${p.version} (`);
      expect(p.texts.join('')).toMatch(/permission/i);
    }
    expect(npmPackages().map((p) => p.name)).toEqual(
      expect.arrayContaining(['react', 'react-dom', 'scheduler', 'd3-scale', 'd3-shape']),
    );
  });

  it('names the crates compiled into the wasm, and not the compiler-only ones', () => {
    const crates = cratePackages().map((p) => p.name);
    expect(crates).toEqual(
      expect.arrayContaining(['serde', 'serde_json', 'libm', 'itoa', 'memchr']),
    );
    expect(crates).not.toContain('syn');
    expect(crates).not.toContain('serde_derive');
    for (const p of cratePackages()) expect(text).toContain(`${p.name} ${p.version} (`);
  });

  it('carries the Rust standard library, which is compiled into the wasm, with the MIT text', () => {
    expect(text).toContain('Rust standard library (core, alloc, std) and dlmalloc');
    expect(text).toContain('Copyright (c) The Rust Project Developers');
    expect(text).toContain('Copyright (c) 2014 Alex Crichton');
  });

  it('has no empty block between two rules', () => {
    expect(text).not.toMatch(/-{20}\n{3,}-{20}/);
    expect(text).not.toMatch(/={20}\n+={20}/);
  });

  it('leaves out the development-only packages', () => {
    const shipped = npmPackages().map((p) => p.name);
    for (const name of Object.keys(manifest.devDependencies)) expect(shipped).not.toContain(name);
  });
});
