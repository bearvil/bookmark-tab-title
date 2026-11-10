import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const locales = readdirSync(new URL('_locales', root));
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const placeholders = (text) => [...text.matchAll(/\$([A-Z]+)\$/g)].map((m) => m[1]).sort();

// Every source file of the extension pages and the service worker.
const sources = (dir, ext) =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(`${dir}${e.name}/`, ext) : e.name.endsWith(ext) ? [read(`${dir}${e.name}`)] : [],
  );
const html = sources('src/', '.html').join('\n');
const code = `${html}\n${sources('src/', '.js').join('\n')}`;

// Keys built from a name at run time: filter_<value>, sort_<value>, scope_<scope>, menuScope_<scope>.
const SCOPES = ['exact', 'below', 'contains', 'host'];
const built = [
  ...['all', 'wider', ...SCOPES, 'off'].map((v) => `filter_${v}`),
  ...['browser', 'name', 'host', 'scope'].map((v) => `sort_${v}`),
  ...SCOPES.map((s) => `scope_${s}`),
  ...SCOPES.map((s) => `menuScope_${s}`),
];

test('every locale has the same messages, with the same placeholders, none empty', () => {
  const [first, ...others] = locales;
  for (const locale of others) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), Object.keys(messages[first]).sort(), locale);
  }
  for (const locale of locales) {
    for (const [key, { message, placeholders: declared = {} }] of Object.entries(messages[locale])) {
      assert.ok(message.trim(), `${locale} ${key} is empty`);
      assert.deepEqual(placeholders(message), placeholders(messages[first][key].message), `${locale} ${key}`);
      assert.deepEqual(Object.keys(declared).map((k) => k.toUpperCase()).sort(), [...new Set(placeholders(message))], `${locale} ${key} declares its placeholders`);
    }
  }
});

test('every message the code uses exists', () => {
  const used = new Set([
    ...[...html.matchAll(/data-i18n="([a-zA-Z_]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((p) => p.split(':')[1].trim())),
    ...[...code.matchAll(/(?:\bt|getMessage)\('([a-zA-Z_]+)'/g)].map((m) => m[1]),
    ...built,
  ]);
  for (const locale of locales) for (const key of used) assert.ok(messages[locale][key], `${locale} is missing ${key}`);
});

test('no message is left over', () => {
  const unused = Object.keys(messages.en).filter((key) => !code.includes(key) && !built.includes(key) && !['extName', 'extDescription'].includes(key));
  assert.deepEqual(unused, []);
});

test('the toolbar badge fits (4 characters at most)', () => {
  for (const locale of locales) assert.ok(messages[locale].badgeOff.message.length <= 4, locale);
});
