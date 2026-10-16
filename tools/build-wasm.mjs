import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'target/wasm32-unknown-unknown/release/invest_engine.wasm');
const shipped = join(root, 'src/engine/invest_engine.wasm');

// `npm test` passes --if-missing so a present wasm is not rebuilt on every run.
if (process.argv.includes('--if-missing') && existsSync(shipped)) process.exit(0);

const cargo = spawnSync(
  'nice',
  [
    '-n',
    '10',
    'cargo',
    'build',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '-p',
    'invest_engine',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (cargo.status !== 0) process.exit(cargo.status ?? 1);
copyFileSync(built, shipped);
