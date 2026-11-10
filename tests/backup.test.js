import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, exportFileName, MAX_FILE_BYTES, parseBackup, planImport, summarize } from '../src/backup.js';

const stored = {
  'scope:mail.google.com/mail/u/1': { scope: 'contains', text: '/u/1/' },
  'scope:e.com/docs': { scope: 'below' },
  'title:mail.google.com/mail/u/1': true,
  'title:e.com/only-title': false,
  appendPageTitle: true,
  'scope:broken': { scope: 'everything' },
  unrelated: 1,
};
const bookmarks = [
  { title: 'Mail – school', url: 'https://mail.google.com/mail/u/1/#inbox' },
  { title: 'Docs', url: 'https://www.e.com/docs/' },
  { title: 'Plain', url: 'https://plain.com/' },
];
const now = new Date('2026-11-10T12:00:00Z');

test('export: every bookmark (also with the default) and every stored setting, one entry per address', () => {
  const file = buildExport(stored, bookmarks, now);
  assert.equal(file.app, 'bookmark-tab-title');
  assert.equal(file.format, 1);
  assert.equal(file.exported, '2026-11-10T12:00:00.000Z');
  assert.equal(file.pageTitleForAll, true);
  assert.deepEqual(file.bookmarks, [
    { address: 'e.com/docs', name: 'Docs', scope: 'below' },
    { address: 'e.com/only-title', scope: 'exact', pageTitle: false },
    { address: 'mail.google.com/mail/u/1', name: 'Mail – school', scope: 'contains', text: '/u/1/', pageTitle: true },
    { address: 'plain.com', name: 'Plain', scope: 'exact' },
  ]);
  assert.equal(exportFileName(now), 'bookmark-tab-title-settings-2026-11-10.json');
});

test('import reads back what export wrote', () => {
  const parsed = parseBackup(JSON.stringify(buildExport(stored, bookmarks, now)));
  assert.equal(parsed.pageTitleForAll, true);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.entries.find((e) => e.key === 'mail.google.com/mail/u/1'), {
    key: 'mail.google.com/mail/u/1',
    scope: 'contains',
    text: '/u/1/',
    pageTitle: true,
  });
});

test('import: full URLs are matched like bookmarks, invalid entries are skipped, the last of an address wins', () => {
  const parsed = parseBackup(
    JSON.stringify({
      app: 'bookmark-tab-title',
      format: 1,
      bookmarks: [
        { address: 'http://www.E.com/docs/#x', scope: 'host' },
        { address: 'e.com/docs', scope: 'below' },
        { address: 'ftp://e.com/', scope: 'host' },
        { address: 42 },
        { address: 'e.com/x', scope: 'everything' },
        { address: 'localhost:8040/app', pageTitle: true },
      ],
    }),
  );
  assert.deepEqual(parsed.entries, [
    { key: 'e.com/docs', scope: 'below' },
    { key: 'localhost:8040/app', scope: 'exact', pageTitle: true },
  ]);
  assert.equal(parsed.skipped, 3);
  assert.equal(parsed.pageTitleForAll, undefined);
});

test('import refuses other files and files that are too large', () => {
  assert.deepEqual(parseBackup('not json'), { error: 'file' });
  assert.deepEqual(parseBackup(JSON.stringify({ app: 'other', format: 1, bookmarks: [] })), { error: 'file' });
  assert.deepEqual(parseBackup(JSON.stringify({ app: 'bookmark-tab-title', format: 2, bookmarks: [] })), { error: 'file' });
  assert.deepEqual(parseBackup(' '.repeat(MAX_FILE_BYTES + 1)), { error: 'size' });
});

test('plan: the file decides for its addresses, defaults are removed, a choice equal to the option is not stored', () => {
  const parsed = {
    pageTitleForAll: false,
    entries: [
      { key: 'a.com', scope: 'host', pageTitle: true },
      { key: 'b.com', scope: 'exact', pageTitle: false },
      { key: 'c.com', scope: 'contains', text: 'x' },
    ],
    skipped: 0,
  };
  assert.deepEqual(planImport(parsed, true), {
    set: { 'scope:a.com': { scope: 'host' }, 'title:a.com': true, 'scope:c.com': { scope: 'contains', text: 'x' } },
    remove: ['appendPageTitle', 'scope:b.com', 'title:b.com', 'title:c.com'],
  });
  // Without the option in the file the current one counts.
  assert.deepEqual(planImport({ entries: [{ key: 'a.com', scope: 'exact', pageTitle: true }], skipped: 0 }, true), {
    set: {},
    remove: ['scope:a.com', 'title:a.com'],
  });
});

test('summary: entries for bookmarks there are now, and for addresses without one', () => {
  const parsed = { entries: [{ key: 'mail.google.com/mail/u/1' }, { key: 'e.com/docs' }, { key: 'new.com' }], skipped: 2 };
  assert.deepEqual(summarize(parsed, bookmarks), { total: 3, matching: 2, other: 1, skipped: 2 });
});

test('a bookmark exported with the default gets the default back on import', () => {
  const file = buildExport({}, [{ title: 'e4', url: 'http://localhost:8440/' }], now);
  const plan = planImport(parseBackup(JSON.stringify(file)), false);
  assert.deepEqual(plan, { set: {}, remove: ['appendPageTitle', 'scope:localhost:8440', 'title:localhost:8440'] });
});
