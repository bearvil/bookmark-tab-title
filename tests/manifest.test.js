import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
