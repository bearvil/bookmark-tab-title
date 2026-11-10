// Opens a visible Chromium with the extension loaded, a throwaway profile and a few sample bookmarks,
// so the extension can be tried by hand without touching your own browser profile.
//
// Usage: npm run try   (close the browser window to finish)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLES = [
  ['Zagreb – wiki', 'https://en.wikipedia.org/wiki/Zagreb'],
  ['My extension repo', 'https://github.com/bearvil/bookmark-tab-title'],
  ['Example (bookmark name)', 'https://example.com/'],
  ['Bearvil studio', 'https://bearvil.github.io/'],
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btt-try-'));
// Show the bookmarks bar so the samples are easy to open, rename and delete.
fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, 'Default', 'Preferences'),
  JSON.stringify({ bookmark_bar: { show_on_all_tabs: true } }),
);

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--start-maximized'],
});

const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; !(await sw.evaluate(() => !!globalThis.chrome?.bookmarks).catch(() => false)); i++) {
  if (i > 100) throw new Error('extension APIs never became ready');
  await new Promise((r) => setTimeout(r, 50));
}
await sw.evaluate(async (samples) => {
  for (const [title, url] of samples) await chrome.bookmarks.create({ parentId: '1', title, url });
}, SAMPLES);

const [first] = context.pages();
for (const [i, [, url]] of SAMPLES.entries()) {
  const page = i === 0 && first ? first : await context.newPage();
  await page.goto(url).catch(() => {});
}

console.log('Chromium is open with the extension and sample bookmarks. Close the window to finish.');
await new Promise((resolve) => context.on('close', resolve));
// Chromium may still be writing its profile for a moment after the window closes.
fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
