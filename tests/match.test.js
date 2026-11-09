import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findBookmark, hostOf, normalizeUrl, originOf, siteOf } from '../src/match.js';

const findTitle = (index, ...urls) => findBookmark(index, ...urls)?.title ?? null;

const tree = [
  {
    children: [
      {
        title: 'Bookmarks bar',
        children: [
          { title: 'Mail', url: 'https://mail.google.com/mail/u/0/#inbox' },
          { title: 'Example', url: 'http://example.com/' },
          { title: '   ', url: 'https://blank.example/' },
          { title: 'Exact', url: 'https://site.example/a#x' },
        ],
      },
      { title: 'Other', children: [{ title: 'Duplicate', url: 'http://example.com/' }] },
    ],
  },
];
const index = buildIndex(tree);

test('normalizeUrl ignores protocol, www, fragment and trailing slash', () => {
  assert.equal(normalizeUrl('https://WWW.Example.com/path/?q=1#top'), 'example.com/path?q=1');
  assert.equal(normalizeUrl('http://example.com'), 'example.com');
  assert.equal(normalizeUrl('http://localhost:8080/a/'), 'localhost:8080/a');
});

test('normalizeUrl rejects non-web URLs', () => {
  assert.equal(normalizeUrl('chrome://settings'), null);
  assert.equal(normalizeUrl('not a url'), null);
});

test('loose match: https + www matches an http bookmark', () => {
  assert.equal(findTitle(index, 'https://www.example.com'), 'Example');
});

test('fragment is ignored (Gmail changes the #)', () => {
  assert.equal(findTitle(index, 'https://mail.google.com/mail/u/0/#inbox/abc'), 'Mail');
});

test('exact match wins over loose match', () => {
  assert.equal(findTitle(index, 'https://site.example/a#x'), 'Exact');
});

test('for duplicates the first one in the tree wins', () => {
  assert.equal(findTitle(index, 'http://example.com/'), 'Example');
});

test('blank bookmark names are skipped', () => {
  assert.equal(findTitle(index, 'https://blank.example/'), null);
});

test('URL before a redirect as the second candidate', () => {
  assert.equal(findTitle(index, 'https://example.com/login', 'http://example.com/'), 'Example');
  assert.equal(findTitle(index, 'https://unknown.example/', undefined), null);
});

test('siteOf groups subdomains of one site', () => {
  assert.equal(siteOf('https://accounts.example.com/login'), 'example.com');
  assert.equal(siteOf('https://www.example.co.uk/a'), 'example.co.uk');
  assert.equal(siteOf('https://shop.example.hr/'), 'example.hr');
});

test('siteOf keeps IPs and single-label hosts as they are', () => {
  assert.equal(siteOf('http://127.0.0.1:8080/'), '127.0.0.1');
  assert.equal(siteOf('http://localhost:3000/'), 'localhost');
  assert.equal(siteOf('not a url'), null);
});

test('different sites differ, e.g. a link shortener and its target', () => {
  assert.notEqual(siteOf('https://bit.ly/xyz'), siteOf('https://other-site.com/'));
});

test('originOf', () => {
  assert.equal(originOf('https://example.com/a?b#c'), 'https://example.com');
  assert.equal(originOf('nope'), null);
});

test('findBookmark returns id, name and URL', () => {
  const idx = buildIndex([{ children: [{ id: '7', title: ' Mail ', url: 'https://mail.example/' }] }]);
  assert.deepEqual(findBookmark(idx, 'https://mail.example/#inbox'), { id: '7', title: 'Mail', url: 'https://mail.example/' });
});

test('hostOf drops www. and keeps subdomains apart', () => {
  assert.equal(hostOf('https://WWW.Example.com/a'), 'example.com');
  assert.equal(hostOf('https://mail.google.com/x'), 'mail.google.com');
  assert.notEqual(hostOf('https://mail.google.com/'), hostOf('https://accounts.google.com/'));
  assert.equal(hostOf('nope'), null);
});
