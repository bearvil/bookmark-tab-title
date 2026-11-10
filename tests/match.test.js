import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  containsMatch,
  covers,
  findBookmark,
  hostOf,
  nextTrail,
  normalizeUrl,
  originOf,
  recordVisit,
  resolve,
  siteOf,
  suggestText,
  TRAIL_LIMIT,
} from '../src/match.js';

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

test('hostOf keeps a port that is not the default one', () => {
  assert.equal(hostOf('http://localhost:8040/a'), 'localhost:8040');
  assert.notEqual(hostOf('http://localhost:8040/'), hostOf('http://localhost:3000/'));
  assert.equal(hostOf('https://www.e.com:8443/'), 'e.com:8443');
  assert.equal(hostOf('https://e.com:443/'), 'e.com');
  assert.equal(hostOf('http://e.com:80/'), 'e.com');
});

// --- Scopes: the scenarios from the use-case analysis (e.com is "E", e.com/a is "A").

const E = 'https://e.com/';
const A = 'https://e.com/a';
const F = 'https://e.com/f';
const scoped = buildIndex([
  {
    children: [
      { title: 'E', url: E },
      { title: 'A', url: A },
      { title: 'F', url: F },
      { title: 'Docs', url: 'https://e.com/docs/' },
      { title: 'Mail 1', url: 'https://mail.google.com/mail/u/1/#inbox' },
      { title: 'Mail 0', url: 'https://mail.google.com/mail/u/0/#inbox' },
      { title: 'Other', url: 'https://other.com/' },
    ],
  },
]);
const scopes = (entries) => new Map(Object.entries(entries));
const walk = (settings, urls) => {
  let trail = null;
  return urls.map((url) => {
    const host = hostOf(url);
    const found = resolve(scoped, settings, { url, trail: trail?.host === host ? trail.urls : [] });
    trail = nextTrail(trail, host, found);
    return found.bookmark?.title ?? null;
  });
};

test('covers: the address and the pages under it, same host only', () => {
  assert.ok(covers('https://e.com/docs/', 'https://www.e.com/docs'));
  assert.ok(covers('https://e.com/docs/', 'http://e.com/docs/a/b?x#y'));
  assert.ok(!covers('https://e.com/docs/', 'https://e.com/docsx'));
  assert.ok(!covers('https://e.com/docs/', 'https://other.com/docs/a'));
  assert.ok(covers('https://e.com/', 'https://e.com/anything'));
  assert.ok(!covers('http://localhost:8040/docs/', 'http://localhost:3000/docs/a'));
});

test('containsMatch: anywhere after the host, any of the texts, ignoring case', () => {
  assert.equal(containsMatch('/u/1/', 'https://mail.google.com/mail/u/1/#inbox'), 5);
  assert.equal(containsMatch('/u/1/ authuser=1', 'https://console.cloud.google.com/run?authuser=1&project=x'), 10);
  assert.equal(containsMatch('PROJECT=x', 'https://console.cloud.google.com/run?project=x'), 9);
  assert.equal(containsMatch('#/p123', 'https://analytics.google.com/analytics/web/#/p123/reports'), 6);
  assert.equal(containsMatch('/u/1/', 'https://mail.google.com/mail/u/0/#inbox'), 0);
  assert.equal(containsMatch('google', 'https://mail.google.com/mail/'), 0, 'the host itself is not searched');
  assert.equal(containsMatch('', 'https://e.com/a'), 0);
  assert.equal(containsMatch('/g/čitaonica', 'https://groups.google.com/g/%C4%8Ditaonica'), 12);
});

test('suggestText: a stable resource id first, then the Google account, then the path', () => {
  assert.equal(suggestText('https://play.google.com/console/u/0/developers/1234567/app-list'), '/developers/1234567');
  assert.equal(suggestText('https://console.cloud.google.com/home/dashboard?authuser=1&project=my-proj'), 'project=my-proj');
  assert.equal(suggestText('https://console.firebase.google.com/u/1/project/my-app/overview'), '/project/my-app');
  assert.equal(suggestText('https://groups.google.com/u/1/a/school.hr/g/staff'), '/a/school.hr/g/staff');
  assert.equal(suggestText('https://docs.google.com/document/d/xyz/edit?authuser=me@example.com'), 'authuser=me@example.com');
  assert.equal(suggestText('https://mail.google.com/mail/u/1/#inbox'), '/u/1/');
  assert.equal(suggestText('https://e.com/a/b/'), '/a/b');
  assert.equal(suggestText('https://e.com/'), '');
});

test('exact (default): the name only on the bookmarked address', () => {
  assert.deepEqual(walk(scopes({}), [E, 'https://e.com/b', A, 'https://e.com/b']), ['E', null, 'A', null]);
});

test('P1: own bookmark on its address, then back to the last whole-host bookmark', () => {
  const s = scopes({ 'e.com': { scope: 'host' } });
  assert.deepEqual(walk(s, [E, A, 'https://e.com/b', 'https://e.com/a']), ['E', 'A', 'E', 'A']);
});

test('P1: a whole-host bookmark takes over until another whole-host bookmark address is visited', () => {
  const s = scopes({ 'e.com': { scope: 'host' }, 'e.com/f': { scope: 'host' } });
  assert.deepEqual(walk(s, [E, 'https://e.com/b', F, 'https://e.com/b', A, 'https://e.com/c', E, 'https://e.com/b']), [
    'E', 'E', 'F', 'F', 'A', 'F', 'E', 'E',
  ]);
});

test('P2: typing the address counts, a deep link without the bookmark address does not', () => {
  const s = scopes({ 'e.com': { scope: 'host' } });
  assert.deepEqual(walk(s, ['https://e.com/b']), [null]);
  assert.deepEqual(walk(s, [E, 'https://e.com/b']), ['E', 'E']);
});

test('whole host after a same-site redirect to another subdomain names the landing host', () => {
  const s = scopes({ 'e.com': { scope: 'host' } });
  const login = 'https://accounts.e.com/login';
  const first = resolve(scoped, s, { url: login, loaded: [login, E] });
  const trail = nextTrail(null, hostOf(login), first);
  const next = resolve(scoped, s, { url: 'https://accounts.e.com/profile', trail: trail.urls });
  assert.deepEqual([first.bookmark.title, next.bookmark?.title], ['E', 'E']);
});

test('only below and whole-host bookmarks enter the trail, so many other bookmarks cannot push them out', () => {
  const s = scopes({ 'e.com': { scope: 'host' } });
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `P${i}`, url: `https://e.com/p${i}` }));
  const idx = buildIndex([{ children: [{ title: 'E', url: E }, ...many] }]);
  let trail = null;
  for (const url of [E, ...many.map((b) => b.url)]) trail = nextTrail(trail, 'e.com', resolve(idx, s, { url, trail: trail?.urls }));
  assert.deepEqual(trail.urls, [E]);
  assert.equal(resolve(idx, s, { url: 'https://e.com/other', trail: trail.urls }).bookmark.title, 'E');
});

test('another port is another host: no whole-host, below or contains name there', () => {
  const app = 'http://localhost:8040/';
  const mail = 'http://localhost:8040/mail/u/1/';
  const idx = buildIndex([{ children: [{ title: 'App', url: app }, { title: 'Mail', url: mail }] }]);
  const s = scopes({ 'localhost:8040': { scope: 'host' }, 'localhost:8040/mail/u/1': { scope: 'contains', text: '/u/1/' } });
  let trail = null;
  const titles = [app, 'http://localhost:8040/x', 'http://localhost:3000/x', 'http://localhost:8040/x'].map((url) => {
    const host = hostOf(url);
    const found = resolve(idx, s, { url, trail: trail?.host === host ? trail.urls : [] });
    trail = nextTrail(trail, host, found);
    return found.bookmark?.title ?? null;
  });
  assert.deepEqual(titles, ['App', 'App', null, null]);
  assert.equal(resolve(idx, s, { url: 'http://localhost:8040/mail/u/1/x' }).bookmark?.title, 'Mail');
  assert.equal(resolve(idx, s, { url: 'http://localhost:3000/mail/u/1/x' }).bookmark, null);
});

test('leaving the host ends the trail', () => {
  const s = scopes({ 'e.com': { scope: 'host' } });
  assert.deepEqual(walk(s, [E, 'https://other.com/x', 'https://e.com/b']), ['E', null, null]);
});

test('below: the pages under the address, the deepest one first, then whole host', () => {
  const s = scopes({ 'e.com': { scope: 'host' }, 'e.com/docs': { scope: 'below' } });
  assert.deepEqual(walk(s, [E, 'https://e.com/docs/x', 'https://e.com/docs/', 'https://e.com/docs/x', 'https://e.com/z']), [
    'E', 'E', 'Docs', 'Docs', 'E',
  ]);
});

test('contains: works without a trail, per Google account', () => {
  const s = scopes({ 'mail.google.com/mail/u/1': { scope: 'contains', text: '/u/1/' } });
  assert.deepEqual(walk(s, ['https://mail.google.com/mail/u/1/#inbox/FMfcg', 'https://mail.google.com/mail/u/0/#inbox']), [
    'Mail 1', 'Mail 0',
  ]);
});

test('contains wins over whole host, an own bookmark wins over contains', () => {
  const s = scopes({ 'e.com': { scope: 'host' }, 'e.com/a': { scope: 'contains', text: 'team=1' } });
  assert.deepEqual(walk(s, [E, 'https://e.com/b?team=1', 'https://e.com/b', A]), ['E', 'A', 'E', 'A']);
});

test('contains only on the bookmark host', () => {
  const s = scopes({ 'e.com/a': { scope: 'contains', text: 'team=1' } });
  assert.deepEqual(walk(s, ['https://other.com/?team=1']), [null]);
});

test('resolve reports the scope of the shown bookmark', () => {
  const s = scopes({ 'e.com/a': { scope: 'contains', text: 'x' } });
  assert.deepEqual(resolve(scoped, s, { url: 'https://e.com/x' }), {
    bookmark: { id: undefined, title: 'A', url: A },
    via: 'contains',
    scope: 'contains',
    text: 'x',
  });
  assert.equal(resolve(scoped, s, { url: E }).scope, 'exact');
});

test('recordVisit keeps the last visits of one host, most recent last', () => {
  let trail = recordVisit(null, 'e.com', E);
  trail = recordVisit(trail, 'e.com', A);
  trail = recordVisit(trail, 'e.com', E);
  assert.deepEqual(trail, { host: 'e.com', urls: [A, E] });
  assert.deepEqual(recordVisit(trail, 'other.com', 'https://other.com/'), { host: 'other.com', urls: ['https://other.com/'] });
  for (let i = 0; i < 30; i++) trail = recordVisit(trail, 'e.com', `https://e.com/${i}`);
  assert.equal(trail.urls.length, TRAIL_LIMIT);
});
