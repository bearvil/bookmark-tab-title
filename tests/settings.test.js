import { test } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for chrome.storage.sync, enough for settings.js.
const store = new Map();
globalThis.chrome = {
  storage: {
    sync: {
      get: async (key) => (key === null ? Object.fromEntries(store) : store.has(key) ? { [key]: store.get(key) } : {}),
      set: async (items) => Object.entries(items).forEach(([k, v]) => store.set(k, v)),
      remove: async (keys) => [keys].flat().forEach((k) => store.delete(k)),
    },
    onChanged: { addListener() {} },
  },
};
const { getAllScopes, getScope, migrateSettings, setScope } = await import('../src/settings.js');

test('exact is the default and is not stored', async () => {
  store.clear();
  await setScope('https://e.com/a', 'host');
  await setScope('https://e.com/a', 'exact');
  assert.equal(store.size, 0);
  assert.deepEqual(await getScope('https://e.com/a'), { scope: 'exact' });
});

test('one setting per normalized address, text only for contains', async () => {
  store.clear();
  await setScope('https://www.e.com/a/', 'contains', '  /u/1/ ');
  await setScope('https://e.com/b', 'host', 'ignored');
  assert.deepEqual(await getScope('http://e.com/a'), { scope: 'contains', text: '/u/1/' });
  assert.deepEqual(await getAllScopes(), new Map([['e.com/a', { scope: 'contains', text: '/u/1/' }], ['e.com/b', { scope: 'host' }]]));
});

test('unknown stored values fall back to exact', async () => {
  store.clear();
  store.set('scope:e.com', { scope: 'everything' });
  assert.deepEqual(await getScope('https://e.com/'), { scope: 'exact' });
});

test('the old "keep on whole host" switch becomes the whole-host scope', async () => {
  store.clear();
  store.set('keepOnHost:e.com', true);
  store.set('keepOnHost:off.com', false);
  await migrateSettings();
  assert.deepEqual(Object.fromEntries(store), { 'scope:e.com': { scope: 'host' } });
  await migrateSettings();
  assert.deepEqual(Object.fromEntries(store), { 'scope:e.com': { scope: 'host' } });
});

test('migration never overwrites a newer setting', async () => {
  store.clear();
  store.set('keepOnHost:e.com', true);
  store.set('scope:e.com', { scope: 'below' });
  await migrateSettings();
  assert.deepEqual(Object.fromEntries(store), { 'scope:e.com': { scope: 'below' } });
});
