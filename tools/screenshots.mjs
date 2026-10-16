// Writes the README's screenshots from the built app at PREVIEW_URL (default http://localhost:4173):
// the analysis of the first example (Madrid resale, F1), its Risk tab and the comparison page at
// 1280 × 800, and the analysis on a 360 px phone. English, light theme, into docs/.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
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

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const READY_MS = 60_000;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 360, height: 800 };

async function openLight(browser, problems, viewport, hash) {
  const page = await newPage(browser, problems, viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(`${ORIGIN}/${hash}`, { waitUntil: 'load' });
  await useEnglish(page);
  return page;
}

async function shoot(page, name) {
  await page.screenshot({ path: join(docs, name) });
  await page.close();
}

async function main() {
  await waitForPreview();
  mkdirSync(docs, { recursive: true });
  const problems = [];
  const browser = await launchChrome();
  try {
    const analyze = await openLight(browser, problems, DESKTOP, '#/');
    await analyze.waitForSelector('.metric-cards', { timeout: READY_MS });
    await shoot(analyze, 'screenshot-analyze.png');

    const risk = await openLight(browser, problems, DESKTOP, '#/');
    await risk.waitForSelector('.metric-cards', { timeout: READY_MS });
    await (await findByText(risk, '[role="tab"]', 'Risk')).click();
    const band = await risk.waitForSelector('svg[role="img"][aria-label^="Monte Carlo band"]', {
      timeout: READY_MS,
    });
    await band.evaluate((el) => {
      el.closest('figure').scrollIntoView({ block: 'center' });
    });
    await shoot(risk, 'screenshot-risk.png');

    const compare = await openLight(browser, problems, DESKTOP, '#/compare');
    await compare.waitForSelector('svg[role="img"][aria-label^="NPV from P10 to P90"]', {
      timeout: READY_MS,
    });
    await shoot(compare, 'screenshot-compare.png');

    const phone = await openLight(browser, problems, PHONE, '#/');
    await phone.waitForSelector('.metric-cards', { timeout: READY_MS });
    await phone.$eval('.analyze-results', (el) => {
      el.scrollIntoView({ block: 'start' });
    });
    await shoot(phone, 'screenshot-analyze-360.png');
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, [], 'a page reported errors');
  console.log(`screenshots written to ${docs}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
