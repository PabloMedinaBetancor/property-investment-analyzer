// The notices that ship with the site. MIT, ISC and Apache ask for the copyright and permission text to travel with
// every copy, and minifying strips the banners, so the build writes one file from the packages that reach the
// browser: the runtime npm packages (from package-lock.json) and the crates compiled into the wasm (cargo metadata).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LICENCE_FILE = /^(licen[sc]e|copying|unlicense)/i;
const RULE = '='.repeat(78);

function textsIn(dir, only) {
  return readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name) && (!only || only.test(name)))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8').trim());
}

/** The npm packages in the lockfile that are not development-only. */
export function npmPackages() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([path, info]) => path.startsWith('node_modules/') && !info.dev && !info.devOptional)
    .map(([path, info]) => {
      const dir = join(root, path);
      return {
        name: path.slice('node_modules/'.length),
        version: info.version,
        license: info.license ?? 'see the text',
        texts: existsSync(dir) ? textsIn(dir) : [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The crates compiled into the wasm: the normal dependencies of the engine, not the proc-macros that only run in the compiler. */
export function cratePackages() {
  const run = spawnSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--filter-platform',
      'wasm32-unknown-unknown',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`cargo metadata failed: ${run.stderr}`);
  const meta = JSON.parse(run.stdout);
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const rootId = meta.packages.find((p) => p.name === 'invest_engine').id;
  const seen = new Set();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (byId.get(id).targets.some((t) => t.kind.includes('proc-macro'))) continue;
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .filter(
      (id) => id !== rootId && !byId.get(id).targets.some((t) => t.kind.includes('proc-macro')),
    )
    .map((id) => {
      const p = byId.get(id);
      const dir = dirname(p.manifest_path);
      // A crate offered under "MIT OR Apache-2.0" is used under the MIT terms, whose text is the short one.
      const mit =
        /\bOR\b/.test(p.license ?? '') && /\bMIT\b/.test(p.license) ? textsIn(dir, /mit/i) : [];
      return {
        name: p.name,
        version: p.version,
        license: p.license ?? 'see the text',
        texts: mit.length > 0 ? mit : textsIn(dir),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The Rust standard library (core, alloc, std) and the allocator vendored with it (dlmalloc) are compiled into the
// wasm too, but they are not in `cargo metadata`. Both are offered under "MIT OR Apache-2.0"; this is the MIT text.
const RUST_STD = {
  name: 'Rust standard library (core, alloc, std) and dlmalloc',
  version: '1.99.0 / 0.2.14',
  license: 'MIT OR Apache-2.0, used under the MIT terms',
  texts: [
    `Copyright (c) The Rust Project Developers (https://thanks.rust-lang.org)
Copyright (c) 2014 Alex Crichton (dlmalloc)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ],
};

export function renderLicenses(npm, crates) {
  const own = readFileSync(join(root, 'LICENSE'), 'utf8').trim();
  const section = (title, packages) => [
    `${RULE}\n${title}\n${RULE}`,
    ...packages.map((p) => {
      if (p.texts.length === 0) throw new Error(`no licence text found for ${p.name} ${p.version}`);
      return `${p.name} ${p.version} (${p.license})\n\n${p.texts.join('\n\n')}`;
    }),
  ];
  return (
    [
      'Property Investment Analyzer',
      own,
      'It includes the following third-party software.',
      ...section('JavaScript packages in the page', npm),
      ...section('Rust crates in the calculation engine (WebAssembly)', [...crates, RUST_STD]),
    ].join('\n\n--------------------------------------------------------------------------\n\n') +
    '\n'
  );
}

export function thirdPartyLicenses() {
  return renderLicenses(npmPackages(), cratePackages());
}
