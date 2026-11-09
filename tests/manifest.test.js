import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const manifest = read('manifest.json');

test('manifest and package.json versions match', () => {
  assert.equal(manifest.version, read('package.json').version);
});

test('every locale defines every message the manifest uses', () => {
  const keys = [manifest.name, manifest.description].map((v) => v.replace(/^__MSG_(.+)__$/, '$1'));
  const locales = readdirSync(new URL('../_locales', import.meta.url));
  assert.ok(locales.includes(manifest.default_locale));
  for (const locale of locales) {
    const messages = read(`_locales/${locale}/messages.json`);
    for (const key of keys) assert.ok(messages[key]?.message, `${locale} is missing ${key}`);
  }
});

test('store description fits the 132 character limit', () => {
  for (const locale of readdirSync(new URL('../_locales', import.meta.url))) {
    assert.ok(read(`_locales/${locale}/messages.json`).extDescription.message.length <= 132, locale);
  }
});

const PACKAGED = ['manifest.json', 'LICENSE', 'src', '_locales', 'icons', 'fonts'];
const packaged = (path) => PACKAGED.some((p) => path === p || path.startsWith(`${p}/`));
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

test('the package script ships exactly the packaged folders', () => {
  const script = read('package.json').scripts.package;
  for (const p of PACKAGED) assert.ok(script.includes(` ${p}`), p);
});

test('every file the manifest references exists and is packaged', () => {
  const paths = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.options_ui.page,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const path of paths) {
    assert.ok(exists(path), `missing ${path}`);
    assert.ok(packaged(path), `not packaged ${path}`);
  }
});

test('every local file the extension pages and styles reference exists and is packaged', () => {
  const pages = ['src/popup/popup.html', 'src/options/options.html', 'src/ui/tokens.css'];
  for (const page of pages) {
    const text = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const refs = [...text.matchAll(/(?:src|href)="([^"#:]+)"|url\('([^':]+)'\)/g)].map((m) => m[1] ?? m[2]);
    for (const ref of refs) {
      const path = normalize(join(dirname(page), ref));
      assert.ok(exists(path), `${page} → missing ${path}`);
      assert.ok(packaged(path), `${page} → not packaged ${path}`);
    }
  }
});
