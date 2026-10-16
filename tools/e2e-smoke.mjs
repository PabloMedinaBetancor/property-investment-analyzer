// One headless Chrome walks the pages a person uses and fails on any error a page reports. It runs
// against `vite preview`, which takes a while to start on a loaded machine, so it waits for the port.
/* global document, location, window */
import assert from 'node:assert/strict';
import {
  ORIGIN,
  findByText,
  launchChrome,
  newPage,
  useEnglish,
  waitForPreview,
} from './browser.mjs';

const SLOW_MS = 60_000;
const READY = { '': '.metric-cards', compare: '.compare-table', benchmark: '.bench-run' };
const NARROW_PAGES = ['', 'compare', 'benchmark'].flatMap((route) =>
  ['English', 'Español'].map((lang) => [route, lang]),
);
const PRICE_STEP = 25_000;

const digits = (text) => Number(text.replace(/\D/g, ''));

async function visit(browser, problems, url) {
  const page = await newPage(browser, problems);
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

async function selectTab(page, label) {
  const tab = await findByText(page, '[role="tab"]', label);
  await tab.click();
  assert.equal(await tab.evaluate((el) => el.getAttribute('aria-selected')), 'true');
}

async function fieldInput(page, label) {
  const labelElement = await findByText(page, 'label', label);
  const input = await labelElement.evaluateHandle((el) => document.getElementById(el.htmlFor));
  return input.asElement();
}

async function typeValue(input, text) {
  await input.evaluate((el) => {
    el.select();
  });
  await input.type(text);
}

async function checkAnalyze(browser, problems) {
  const page = await visit(browser, problems, `${ORIGIN}/#/`);
  await useEnglish(page);
  await page.waitForSelector('.metric-cards');
  assert.equal(await page.$('[role="alert"]'), null, 'the analyze page shows an alert on load');

  const price = await fieldInput(page, 'Purchase price');
  const before = digits(await price.evaluate((el) => el.value));
  const resultsBefore = await page.$eval('.analyze-results', (el) => el.innerText);
  const hashBefore = await page.evaluate(() => location.hash);
  await typeValue(price, String(before + PRICE_STEP));
  await page.waitForFunction(
    (text) => document.querySelector('.analyze-results').innerText !== text,
    { timeout: SLOW_MS },
    resultsBefore,
  );
  await page.waitForFunction((hash) => location.hash !== hash, { timeout: SLOW_MS }, hashBefore);
  const shared = await page.evaluate(() => location.href);

  const reopened = await visit(browser, problems, shared);
  await reopened.waitForSelector('.metric-cards');
  const restored = await fieldInput(reopened, 'Purchase price');
  assert.equal(
    digits(await restored.evaluate((el) => el.value)),
    before + PRICE_STEP,
    'the shared address does not restore the edited price',
  );
  await reopened.close();

  await selectTab(page, 'Cash flow');
  await selectTab(page, 'Loan');
  await findByText(page, 'caption', 'Loan schedule');
  await selectTab(page, 'Risk');
  await page.waitForSelector('svg[role="img"][aria-label^="Monte Carlo band"]', {
    timeout: SLOW_MS,
  });
  await selectTab(page, 'Sensitivity');
  await page.waitForSelector('svg[role="img"][aria-label^="Tornado chart"]', { timeout: SLOW_MS });
  await page.close();
}

async function checkCompare(browser, problems) {
  const page = await visit(browser, problems, `${ORIGIN}/#/compare`);
  await page.waitForSelector('.compare-table');
  // The cumulative chart's data table has a head of its own, with the same class.
  const headers = await page.$$eval('#compare-metrics ~ .table-scroll thead th', (cells) =>
    cells.map((cell) => cell.textContent.trim()),
  );
  assert.equal(headers.length, 4, `the compare table has ${headers.length} columns, not 4`);
  await page.waitForSelector('svg[role="img"][aria-label^="NPV from P10 to P90"]', {
    timeout: SLOW_MS,
  });
  await page.close();
}

async function checkBenchmark(browser, problems) {
  const page = await visit(browser, problems, `${ORIGIN}/#/benchmark`);
  await page.waitForSelector('.bench-run:not([disabled])');
  await page.click('.bench-run');
  await page.waitForSelector('p.bench-ok, p.bench-bad', { timeout: SLOW_MS });
  assert.ok(await page.$('p.bench-ok'), 'the benchmark parity check failed');
  await page.close();
}

async function checkSpanish(browser, problems) {
  const page = await visit(browser, problems, `${ORIGIN}/#/`);
  await page.waitForSelector('.metric-cards');
  await (await findByText(page, '.app-lang button', 'Español')).click();
  await page.waitForFunction(
    () => document.querySelector('.app-nav a').textContent.trim() === 'Analizar',
    { timeout: SLOW_MS },
  );
  await fieldInput(page, 'Precio de compra');
  await page.close();
}

// A phone is 360 px wide; a page wider than its window makes the whole thing scroll sideways.
async function checkNarrow(browser, problems) {
  for (const [route, lang] of NARROW_PAGES) {
    const page = await newPage(browser, problems, { width: 360, height: 740 });
    await page.goto(`${ORIGIN}/#/${route}`, { waitUntil: 'load' });
    await page.waitForSelector('.app-lang button[lang="en"]');
    await (await findByText(page, '.app-lang button', lang)).click();
    await page.waitForSelector(READY[route]);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(
      scrollWidth <= innerWidth,
      `${route || 'analyze'} in ${lang} is ${scrollWidth} px wide in a ${innerWidth} px window`,
    );
    await page.close();
  }
}

// A table wider than its box needs a sideways scroll and hides its last column. The widest pair of examples
// (a US-style rental against the Canary Islands one, whose payback is «not within the years held» on both sides)
// is measured as well as the default pair.
async function checkTablesFit(browser, problems) {
  for (const width of [1280, 1024]) {
    for (const lang of ['en', 'es']) {
      const page = await newPage(browser, problems, { width, height: 900 });
      await page.evaluateOnNewDocument((code) => localStorage.setItem('pia.lang', code), lang);
      await page.goto(`${ORIGIN}/#/compare`, { waitUntil: 'load' });
      await page.waitForSelector('.compare-table');
      await page.waitForSelector(
        'svg[role="img"][aria-label^="NPV"], svg[role="img"][aria-label^="VAN"]',
        { timeout: SLOW_MS },
      );
      const [first, second] = await page.$$('select');
      for (const pair of [null, ['us', 'las-palmas']]) {
        if (pair) {
          await first.select(`example:${pair[0]}`);
          await second.select(`example:${pair[1]}`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        const tables = await page.$$eval('.compare-table', (nodes) =>
          nodes.map((table) => ({
            scrollWidth: table.scrollWidth,
            clientWidth: table.closest('.table-scroll').clientWidth,
          })),
        );
        for (const { scrollWidth, clientWidth } of tables) {
          assert.ok(
            scrollWidth <= clientWidth,
            `a compare table in ${lang} is ${scrollWidth} px in a ${clientWidth} px box at ${width} px`,
          );
        }
      }
      await page.close();
    }
  }
}

// The build writes the third-party notices next to index.html; the footer links to them.
async function checkLicences() {
  const response = await fetch(`${ORIGIN}/THIRD-PARTY-LICENSES.txt`);
  assert.equal(response.status, 200, 'THIRD-PARTY-LICENSES.txt is not served');
  const text = await response.text();
  for (const name of ['react 18', 'd3-scale', 'serde_json', 'libm']) {
    assert.ok(text.includes(name), `THIRD-PARTY-LICENSES.txt does not name ${name}`);
  }
}

async function main() {
  const started = Date.now();
  await waitForPreview();
  await checkLicences();
  const problems = [];
  const browser = await launchChrome();
  try {
    await checkAnalyze(browser, problems);
    await checkCompare(browser, problems);
    await checkBenchmark(browser, problems);
    await checkSpanish(browser, problems);
    await checkNarrow(browser, problems);
    await checkTablesFit(browser, problems);
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, [], 'a page reported errors');
  console.log(`e2e-smoke: passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
