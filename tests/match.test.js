import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findTitle, normalizeUrl } from '../src/match.js';

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
