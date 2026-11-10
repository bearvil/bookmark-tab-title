// Renders the extension icons and store graphics from their SVG sources to PNG
// using the Playwright Chromium that is already a dev dependency.
//
// Usage: node scripts/render-icons.js [part of an output path, e.g. marquee]
//
// Store SVGs load the Nunito font from Google Fonts, so they are rendered
// inline in a page (not as <img>) and the script waits for fonts to load.

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jobs = [
  // Toolbar and extension-page sizes use the full-bleed variant drawn on a 32 grid.
  { src: 'icons/icon-toolbar.svg', out: 'icons/icon-16.png', w: 16, h: 16 },
  { src: 'icons/icon-toolbar.svg', out: 'icons/icon-32.png', w: 32, h: 32 },
  { src: 'icons/icon-toolbar.svg', out: 'icons/icon-48.png', w: 48, h: 48 },
  // 128 px uses the master: 96 px artwork with a 16 px transparent margin.
  { src: 'icons/icon.svg', out: 'icons/icon-128.png', w: 128, h: 128 },
  { src: 'store/promo-small-440x280.svg', out: 'store/promo-small-440x280.png', w: 440, h: 280, opaque: true },
  { src: 'store/promo-marquee-1400x560.svg', out: 'store/promo-marquee-1400x560.png', w: 1400, h: 560, opaque: true },
  { src: 'store/screenshot-1280x800.svg', out: 'store/screenshot-1280x800.png', w: 1280, h: 800, opaque: true },
];

const only = process.argv[2];
const browser = await chromium.launch();
try {
  for (const job of jobs.filter((j) => !only || j.out.includes(only))) {
    const svg = await readFile(path.join(root, job.src), 'utf8');
    const page = await browser.newPage({
      viewport: { width: job.w, height: job.h },
      deviceScaleFactor: 1,
    });
    const html = `<!doctype html><html><head><style>
      html, body { margin: 0; padding: 0; background: transparent; }
      svg { display: block; width: ${job.w}px; height: ${job.h}px; }
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(root, job.out),
      omitBackground: !job.opaque,
      clip: { x: 0, y: 0, width: job.w, height: job.h },
    });
    await page.close();
    console.log(`${job.out} (${job.w}x${job.h})`);
  }
} finally {
  await browser.close();
}
