// What the headless scripts share: the address of `vite preview`, a headless Chrome, and the pages
// they open. Each script says what it checks; this file only gets the page there.
/* global document */
import puppeteer from 'puppeteer-core';

export const ORIGIN = process.env.PREVIEW_URL ?? 'http://localhost:4173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PREVIEW_WAIT_MS = 90_000;
// Puppeteer's 30 s default is too short on a loaded machine, where Chrome can take longer to start.
const LAUNCH_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForPreview() {
  const deadline = Date.now() + PREVIEW_WAIT_MS;
  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return;
    } catch {
      // Refused until vite preview listens; keep trying.
    }
    if (Date.now() > deadline) {
      throw new Error(`no preview at ${ORIGIN} after ${PREVIEW_WAIT_MS / 1000} s`);
    }
    await sleep(500);
  }
}

export function launchChrome() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    timeout: LAUNCH_MS,
    // The CI runner's AppArmor blocks Chrome's sandbox, and a small /dev/shm breaks pages.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

// Errors the page reports are collected in `problems` for the caller to judge.
export async function newPage(browser, problems, { width = 1280, height = 800 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  page.on('pageerror', (error) => {
    problems.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  return page;
}

export async function findByText(page, selector, text) {
  const handle = await page.waitForFunction(
    (query, wanted) =>
      [...document.querySelectorAll(query)].find((el) => el.textContent.trim() === wanted),
    {},
    selector,
    text,
  );
  return handle.asElement();
}

// Chooses the English page, the one the scripts and the README use.
export async function useEnglish(page) {
  await page.waitForSelector('.app-lang button[lang="en"]');
  await (await findByText(page, '.app-lang button', 'English')).click();
}
