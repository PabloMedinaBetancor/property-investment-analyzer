// Runs the benchmark page in headless Chrome for 10 000 scenarios over 10 and 30 years, after its parity
// gate, and prints one JSON line: the timings of both implementations, the performance bars
// (300 ms for 10 years, 400 ms for 30; each met or missed), and the machine, browser and load before and after.
// It needs a built app served at PREVIEW_URL (default http://localhost:4173): `npm run build`, then
// `vite preview --port 4173`.
/* global window, HTMLAnchorElement */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN,
  findByText,
  launchChrome,
  newPage,
  useEnglish,
  waitForPreview,
} from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOLDINGS = [10, 30];
const RUN_MS = 10 * 60_000;
// The time bar for each holding: 300 ms for 10 years, 400 ms for 30.
const TIME_BARS_MS = { 10: 300, 30: 400 };
const WASM_LIMIT_BYTES = 400_000;
// The five-minute load below which the machine counts as quiet enough to time.
const QUIET_LOAD5 = 2.5;

const readLoad = () =>
  readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3).map(Number);

const cpuModel = () =>
  readFileSync('/proc/cpuinfo', 'utf8').match(/^model name\s*:\s*(.+)$/m)?.[1] ?? 'unknown';

function wasmBytes() {
  const dir = join(root, 'dist/assets');
  const file = readdirSync(dir).find((name) => /^invest_engine-.*\.wasm$/.test(name));
  if (!file) throw new Error(`no invest_engine wasm in ${dir}: run npm run build first`);
  return statSync(join(dir, file)).size;
}

// Runs in the page before its scripts. The page saves its report by a download link; this keeps the
// blob for the script to read and stops the click, so no file is written.
function keepDownloads() {
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    window.__benchDownload = object;
    return createObjectURL(object);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function clickUnlessDownload() {
    if (!this.download) click.call(this);
  };
}

const timing = (measured) => ({
  medianMs: measured.median,
  minMs: measured.min,
  p90Ms: measured.p90,
  scenariosPerSecond: measured.scenariosPerSecond,
  checksum: measured.checksum,
});

async function measure(browser, problems, years) {
  const page = await newPage(browser, problems);
  await page.evaluateOnNewDocument(keepDownloads);
  await page.goto(`${ORIGIN}/#/benchmark`, { waitUntil: 'load' });
  await useEnglish(page);
  await page.select('.bench-controls label:nth-child(2) select', String(years));
  await page.waitForSelector('.bench-run:not([disabled])');
  await page.click('.bench-run');
  await page.waitForSelector('.bench-table, p.bench-bad', { timeout: RUN_MS });
  assert.equal(await page.$('p.bench-bad'), null, `the parity check failed at ${years} years`);
  await (await findByText(page, 'button', 'Download results (JSON)')).click();
  const { parity, report } = JSON.parse(await page.evaluate(() => window.__benchDownload.text()));
  await page.close();
  return { parity, report };
}

function bar(name, limit, measured, unit) {
  return { name, limit, measured, unit, met: measured <= limit };
}

async function main() {
  const loadStart = readLoad();
  const measuredAt = new Date().toISOString();
  await waitForPreview();
  const problems = [];
  const browser = await launchChrome();
  let record;
  try {
    const runs = [];
    for (const years of HOLDINGS) {
      const { parity, report } = await measure(browser, problems, years);
      runs.push({
        years,
        n: report.n,
        parityWorstRelativeDifference: parity.worst,
        wasm: timing(report.wasm),
        js: timing(report.js),
        ratio: report.ratio,
        coldStartMs: report.coldStart,
      });
    }
    record = {
      measuredAt,
      machine: { cpu: cpuModel(), logicalCores: cpus().length },
      browser: await browser.version(),
      load: { start: loadStart, end: readLoad(), quietAtStart: loadStart[1] < QUIET_LOAD5 },
      runs,
      bars: [
        ...runs.map((run) =>
          bar(
            `simulate 10 000 × ${run.years} years, wasm median`,
            TIME_BARS_MS[run.years],
            run.wasm.medianMs,
            'ms',
          ),
        ),
        bar('invest_engine.wasm size', WASM_LIMIT_BYTES, wasmBytes(), 'bytes'),
      ],
    };
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, [], 'a page reported errors while it was measured');
  console.log(JSON.stringify(record));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
