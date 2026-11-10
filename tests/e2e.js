// E2E: real Chromium with the extension loaded, real bookmarks, local server.
// Run: npm run test:e2e  (HEADED=1 to watch)
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const page = (title, body = '') =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

const routes = {
  '/plain': page('Original'),
  '/other': page('Other'),
  '/landing': page('Landing'),
  '/slash/': page('Slash'),
  '/spa': page('SPA'),
  '/attacker': page('Attacker'),
  '/host/a': page('Host A', '<a id="next" href="/host/b">next</a>'),
  '/host/b': page('Host B', '<a id="away" href="__AWAY__">away</a>'),
  '/plain2': page('Plain two'),
  // Like Gmail: the page keeps changing its own title.
  // Adds a counter to whatever the title is now, like pages that do "(n) " + document.title.
  '/prefix': page('Prefix', `<script>let n = 0; setInterval(() => { document.title = '(' + ++n + ') ' + document.title.replace(/^\\(\\d+\\) /, ''); }, 100);</script>`),
  // A title with markup in it, shown by the browser as text.
  '/markup': page('&lt;div style="color:#d40a0a"&gt;E4&lt;/div&gt; Admin &amp; more'),
  // A title that already has the bookmark name in it, at the start and at the end.
  '/named': page('Nm Admin - Nm'),
  // An app that puts back a title it read from the tab earlier.
  '/restore': page('Restore', `<script>setTimeout(() => { const t = document.title; document.title = 'Other'; setTimeout(() => { document.title = t; }, 300); }, 800);</script>`),
  '/upd': page('Admin page'),
  '/onoff': page('On off'),
  '/dyn': page('Dyn', `<script>let i = 0; setInterval(() => { document.title = '(' + ++i + ') Inbox'; }, 50);</script>`),
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/redir') {
    res.writeHead(302, { location: '/landing' }).end();
    return;
  }
  // Same server, different site (127.0.0.1 → localhost), like a link shortener.
  if (pathname === '/xredir') {
    res.writeHead(302, { location: `http://localhost:${server.address().port}/landing` }).end();
    return;
  }
  // A bookmarked page that answers slowly, so a navigation to it can be aborted.
  if (pathname === '/slow') {
    setTimeout(() => res.writeHead(200, { 'content-type': 'text/html' }).end(page('Slow')), 3000);
    return;
  }
  // Any page under /s/ for the scope tests, with a link that opens /s/b in a new tab.
  if (pathname.startsWith('/s/')) {
    res.writeHead(200, { 'content-type': 'text/html' }).end(page(`Page ${pathname}`, '<a id="nt" href="/s/b" target="_blank">new tab</a>'));
    return;
  }
  const html = routes[pathname];
  res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(html ?? 'not found');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
// Same server under another host name, to leave the host.
const away = `http://localhost:${server.address().port}/landing`;
routes['/host/b'] = routes['/host/b'].replace('__AWAY__', away);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btt-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
// The worker can be reported before its extension APIs are ready.
for (let i = 0; !(await sw.evaluate(() => !!globalThis.chrome?.bookmarks).catch(() => false)); i++) {
  if (i > 100) throw new Error('extension APIs never became ready');
  await new Promise((r) => setTimeout(r, 50));
}
const bookmark = {
  create: (title, url) => sw.evaluate(([t, u]) => chrome.bookmarks.create({ parentId: '1', title: t, url: u }).then((b) => b.id), [title, url]),
  rename: (id, title) => sw.evaluate(([i, t]) => chrome.bookmarks.update(i, { title: t }), [id, title]),
  remove: (id) => sw.evaluate((i) => chrome.bookmarks.remove(i), id),
};

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name} — ${err.message}`]);
  }
}
async function expectTitleLike(p, pattern, timeout = 3000) {
  const end = Date.now() + timeout;
  let actual;
  while (Date.now() < end) {
    actual = await p.title();
    if (pattern.test(actual)) return;
    await p.waitForTimeout(50);
  }
  throw new Error(`expected ${pattern}, got "${actual}"`);
}
async function expectTitle(p, expected, timeout = 3000) {
  const end = Date.now() + timeout;
  let actual;
  while (Date.now() < end) {
    actual = await p.title();
    if (actual === expected) return;
    await p.waitForTimeout(50);
  }
  throw new Error(`expected "${expected}", got "${actual}"`);
}

const tab = await context.newPage();
let id;

await check('opened bookmark → tab title is the bookmark name', async () => {
  id = await bookmark.create('My name', `${base}/plain`);
  await tab.goto(`${base}/plain`);
  await expectTitle(tab, 'My name');
});
await check('page that is not a bookmark keeps its own title', async () => {
  await tab.goto(`${base}/other`);
  await tab.waitForTimeout(500);
  await expectTitle(tab, 'Other');
});
await check('renamed bookmark → title changes immediately', async () => {
  await tab.goto(`${base}/plain`);
  await expectTitle(tab, 'My name');
  await bookmark.rename(id, 'New name');
  await expectTitle(tab, 'New name');
});
await check('deleted bookmark → page title is restored', async () => {
  await bookmark.remove(id);
  await expectTitle(tab, 'Original');
});
await check('bookmark added while the page is open → title changes', async () => {
  await tab.goto(`${base}/other`);
  await bookmark.create('Other bookmark', `${base}/other`);
  await expectTitle(tab, 'Other bookmark');
});
await check('page that changes its own title (Gmail) → bookmark name stays', async () => {
  await bookmark.create('Mail', `${base}/dyn`);
  await tab.goto(`${base}/dyn`);
  await expectTitle(tab, 'Mail');
  for (let i = 0; i < 10; i++) {
    await tab.waitForTimeout(100);
    await expectTitle(tab, 'Mail', 200);
  }
});
await check('bookmark with a redirect (/redir → /landing) → bookmark name', async () => {
  await bookmark.create('Redirected', `${base}/redir`);
  await tab.goto(`${base}/redir`);
  if (!tab.url().endsWith('/landing')) throw new Error(`not redirected: ${tab.url()}`);
  await expectTitle(tab, 'Redirected');
});
await check('loose match: bookmark /slash/, opened /slash#section', async () => {
  await bookmark.create('Slash bookmark', `${base}/slash/`);
  await tab.goto(`${base}/slash/#section`);
  await expectTitle(tab, 'Slash bookmark');
});
await check('SPA navigation (pushState) inside a bookmark → name stays', async () => {
  await bookmark.create('App', `${base}/spa`);
  await tab.goto(`${base}/spa`);
  await expectTitle(tab, 'App');
  await tab.evaluate(() => history.pushState({}, '', '/spa/detail'));
  await tab.waitForTimeout(500);
  await expectTitle(tab, 'App');
});
await check('aborted navigation to a bookmark does not leak its name to the page', async () => {
  await bookmark.create('Secret name', `${base}/slow`);
  await tab.goto(`${base}/attacker`);
  await tab.evaluate(() => {
    location.href = '/slow';
    setTimeout(() => {
      window.stop();
      history.pushState({}, '', '/attacker/next');
    }, 300);
  });
  await tab.waitForTimeout(1500);
  await expectTitle(tab, 'Attacker');
});
await check('redirect to another site does not carry the bookmark name', async () => {
  await bookmark.create('Shortener', `${base}/xredir`);
  await tab.goto(`${base}/xredir`);
  if (!tab.url().startsWith('http://localhost:')) throw new Error(`not redirected: ${tab.url()}`);
  await tab.waitForTimeout(500);
  await expectTitle(tab, 'Landing');
});
await check('second copy of the content script (extension update) restores the right title', async () => {
  const id = await bookmark.create('Twice', `${base}/plain`);
  await tab.goto(`${base}/plain`);
  await expectTitle(tab, 'Twice');
  await sw.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/content.js'] });
  }, `${base}/plain`);
  await bookmark.rename(id, 'Twice renamed');
  await expectTitle(tab, 'Twice renamed');
  await bookmark.remove(id);
  await tab.waitForTimeout(300);
  await expectTitle(tab, 'Original');
});
await check('many bookmark changes at once are refreshed once, and the names are right', async () => {
  // Count index rebuilds: the service worker calls chrome.bookmarks.getTree() for each one.
  await sw.evaluate(() => {
    globalThis.treeReads = 0;
    const getTree = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    chrome.bookmarks.getTree = (...args) => (globalThis.treeReads++, getTree(...args));
  });
  await tab.goto(`${base}/plain2`);
  const folder = await sw.evaluate(async () => {
    const f = await chrome.bookmarks.create({ parentId: '2', title: 'Bulk' });
    for (let i = 0; i < 300; i++) await chrome.bookmarks.create({ parentId: f.id, title: `Bulk ${i}`, url: `https://bulk.example/${i}` });
    return f.id;
  });
  await bookmark.create('Bulk named', `${base}/plain2`);
  await expectTitle(tab, 'Bulk named');
  const reads = await sw.evaluate(() => globalThis.treeReads);
  await sw.evaluate((id) => chrome.bookmarks.removeTree(id), folder);
  if (reads > 5) throw new Error(`index rebuilt ${reads} times for 301 changes`);
});
const extensionId = new URL(sw.url()).host;
const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
const popupFor = async (url) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html?tab=${await tabIdOf(url)}`);
  await popup.waitForTimeout(300);
  return popup;
};
// The settings page in a given view (stored per device); the scope tests use the flat list.
const optionsPage = async (view = { mode: 'list' }, query = '') => {
  await sw.evaluate((v) => (v ? chrome.storage.local.set({ optionsView: v }) : chrome.storage.local.remove('optionsView')), view);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html${query}`);
  await options.waitForSelector(view?.mode === 'list' ? '#list select' : '#tree .folder');
  return options;
};

// Scope tests run on another host name of the same server ("localhost"), so the bookmarks above do not interfere.
// E = /s/ and A = /s/a are the e.com and e.com/a of the use-case analysis.
const L = `http://localhost:${server.address().port}`;
const E = `${L}/s/`;
const A = `${L}/s/a`;
// The same pages on another port: another app on the same host name.
const server2 = http.createServer(server.listeners('request')[0]);
await new Promise((r) => server2.listen(0, r));
const L2 = `http://localhost:${server2.address().port}`;
const scoped = await context.newPage();
const scopeIn = (popup) => popup.$eval('[name="scope"]:checked', (r) => r.value);

await check('only this address (default): another page of the host shows its own title', async () => {
  await bookmark.create('E', E);
  await bookmark.create('A', A);
  await scoped.goto(E);
  await expectTitle(scoped, 'E');
  await scoped.goto(`${L}/s/b`);
  await scoped.waitForTimeout(400);
  await expectTitle(scoped, 'Page /s/b');
});
await check('popup shows the bookmark of the page and its scope', async () => {
  await scoped.goto(E);
  const popup = await popupFor(E);
  const name = await popup.inputValue('#name');
  const scope = await scopeIn(popup);
  const detail = await popup.textContent('[data-detail="exact"]');
  const because = await popup.isVisible('#shown-because');
  await popup.close();
  if (name !== 'E' || scope !== 'exact' || detail !== 'localhost:' + server.address().port + '/s' || because) {
    throw new Error(JSON.stringify({ name, scope, detail, because }));
  }
});
await check('popup: whole host → the name stays on other pages and after a reload', async () => {
  const popup = await popupFor(E);
  await popup.click('[name="scope"][value="host"]');
  await popup.waitForTimeout(200);
  await popup.close();
  await scoped.goto(`${L}/s/b`);
  await expectTitle(scoped, 'E');
  await scoped.reload();
  await expectTitle(scoped, 'E');
});
await check('a bookmark of its own shows its name, then the tab returns to the whole-host name', async () => {
  await scoped.goto(A);
  await expectTitle(scoped, 'A');
  await scoped.goto(`${L}/s/b`);
  await expectTitle(scoped, 'E');
});
await check('popup on a page named by the trail shows that bookmark and why', async () => {
  const popup = await popupFor(`${L}/s/b`);
  const name = await popup.inputValue('#name');
  const scope = await scopeIn(popup);
  const because = await popup.isVisible('#shown-because');
  await popup.close();
  if (name !== 'E' || scope !== 'host' || !because) throw new Error(JSON.stringify({ name, scope, because }));
});
await check('a link opened in a new tab keeps the trail', async () => {
  const [opened] = await Promise.all([context.waitForEvent('page'), scoped.click('#nt')]);
  await expectTitle(opened, 'E');
  await opened.close();
});
await check('a deep link in a fresh tab does not get the whole-host name', async () => {
  const fresh = await context.newPage();
  await fresh.goto(`${L}/s/b`);
  await fresh.waitForTimeout(400);
  await expectTitle(fresh, 'Page /s/b');
  await fresh.close();
});
await check('leaving the host ends the whole-host name', async () => {
  await scoped.goto(`${base}/attacker`);
  await scoped.goto(`${L}/s/b`);
  await scoped.waitForTimeout(400);
  await expectTitle(scoped, 'Page /s/b');
});
const optionsRow = async (title) => {
  const options = await optionsPage();
  const name = options.locator('[data-field="title"]', { hasText: new RegExp(`^${title}$`) });
  return [options, options.locator('#list li').filter({ has: name })];
};
await check('options page: pages under the address win over the whole host', async () => {
  await bookmark.create('Docs', `${L}/s/docs/`);
  const [options, docs] = await optionsRow('Docs');
  await docs.locator('select').selectOption('below');
  await options.waitForTimeout(200);
  await options.close();
  await scoped.goto(E);
  await expectTitle(scoped, 'E');
  await scoped.goto(`${L}/s/docs/x`);
  await expectTitle(scoped, 'E');
  await scoped.goto(`${L}/s/docs/`);
  await expectTitle(scoped, 'Docs');
  await scoped.goto(`${L}/s/docs/x/y`);
  await expectTitle(scoped, 'Docs');
  await scoped.goto(`${L}/s/z`);
  await expectTitle(scoped, 'E');
});
await check('popup: address contains (Google account) → the name in any tab, suggested text', async () => {
  const mail = `${L}/s/mail/u/1/`;
  await bookmark.create('Mail 1', mail);
  await scoped.goto(mail);
  await expectTitle(scoped, 'Mail 1');
  const popup = await popupFor(mail);
  await popup.click('[name="scope"][value="contains"]');
  await popup.waitForTimeout(200);
  const text = await popup.inputValue('#contains-text');
  await popup.close();
  if (text !== '/u/1/') throw new Error(`suggested "${text}"`);
  const fresh = await context.newPage();
  await fresh.goto(`${L}/s/mail/u/1/thread`);
  await expectTitle(fresh, 'Mail 1');
  await fresh.goto(`${L}/s/mail/u/0/`);
  await fresh.waitForTimeout(400);
  await expectTitle(fresh, 'Page /s/mail/u/0/');
  await fresh.close();
});
await check('another port is another app: no whole-host or contains name there', async () => {
  const tab = await context.newPage();
  await tab.goto(E);
  await expectTitle(tab, 'E');
  await tab.goto(`${L2}/s/b`);
  await tab.waitForTimeout(400);
  await expectTitle(tab, 'Page /s/b');
  await tab.goto(`${L}/s/b`);
  await tab.waitForTimeout(400);
  await expectTitle(tab, 'Page /s/b');
  await tab.goto(`${L2}/s/mail/u/1/thread`);
  await tab.waitForTimeout(400);
  await expectTitle(tab, 'Page /s/mail/u/1/thread');
  await tab.close();
});
await check('popup: typing another text changes where the name shows', async () => {
  const popup = await popupFor(`${L}/s/mail/u/1/`);
  await popup.fill('#contains-text', 'team=7 /u/2/');
  await popup.waitForTimeout(600);
  await popup.close();
  await scoped.goto(`${L}/s/x?team=7`);
  await expectTitle(scoped, 'Mail 1');
  await scoped.goto(`${L}/s/mail/u/1/thread`);
  await expectTitle(scoped, 'E');
});
await check('popup keeps editing its own bookmark when the change moves the name to another one', async () => {
  await scoped.goto(`${L}/s/x?team=7`);
  await expectTitle(scoped, 'Mail 1');
  const popup = await popupFor(`${L}/s/x?team=7`);
  await popup.fill('#contains-text', 'nothing-here');
  await popup.waitForTimeout(600);
  await popup.fill('#contains-text', 'nothing-here-2');
  await popup.locator('#name').focus();
  await popup.waitForTimeout(300);
  const name = await popup.inputValue('#name');
  await popup.close();
  await expectTitle(scoped, 'E');
  const e = await sw.evaluate((k) => chrome.storage.sync.get(k).then((r) => r[k]), `scope:localhost:${server.address().port}/s`);
  if (name !== 'Mail 1' || e?.scope !== 'host') throw new Error(JSON.stringify({ name, e }));
});
await check('options page shows the same choice and changing it works everywhere', async () => {
  const [options, row] = await optionsRow('E');
  const before = await row.locator('select').inputValue();
  await row.locator('select').selectOption('exact');
  await options.waitForTimeout(200);
  await options.close();
  if (before !== 'host') throw new Error(`options showed "${before}"`);
  await scoped.goto(E);
  await scoped.goto(`${L}/s/b`);
  await scoped.waitForTimeout(400);
  await expectTitle(scoped, 'Page /s/b');
});
await check('popup renames the bookmark and the tab follows', async () => {
  await bookmark.create('Host bookmark', `${base}/host/a`);
  await tab.goto(`${base}/host/a`);
  await expectTitle(tab, 'Host bookmark');
  const popup = await popupFor(`${base}/host/a`);
  await popup.fill('#name', 'Renamed in popup');
  await popup.waitForTimeout(600);
  await popup.close();
  await expectTitle(tab, 'Renamed in popup');
});
await check('popup on a page that is not a bookmark can bookmark it', async () => {
  // A fresh tab: the main tab is anchored to a bookmark on this host, which the popup would show instead.
  const fresh = await context.newPage();
  await fresh.goto(`${base}/landing`);
  const popup = await popupFor(`${base}/landing`);
  if (await popup.locator('#state-none').isHidden()) throw new Error('popup does not offer to bookmark');
  await popup.click('#add-bookmark');
  await popup.waitForSelector('#state-bookmark:not([hidden])');
  await popup.fill('#name', 'Fresh bookmark');
  await popup.waitForTimeout(600);
  await popup.close();
  await expectTitle(fresh, 'Fresh bookmark');
  await fresh.close();
});
// --- Settings page: folders, one list, filter and order.
const work = await sw.evaluate(async (b) => {
  const folder = await chrome.bookmarks.create({ parentId: '1', title: 'Work' });
  const deep = await chrome.bookmarks.create({ parentId: folder.id, title: 'Deep' });
  await chrome.bookmarks.create({ parentId: folder.id, title: 'Work b', url: `${b}/work/b` });
  await chrome.bookmarks.create({ parentId: folder.id, title: 'Work a', url: `${b}/work/a` });
  const one = await chrome.bookmarks.create({ parentId: deep.id, title: 'Deep one', url: `${b}/work/deep` });
  await chrome.bookmarks.create({ parentId: '2', title: 'Elsewhere', url: `${b}/elsewhere` });
  return { folder: folder.id, deep: deep.id, one: one.id };
}, base);
const folderOf = (options, id) => options.locator(`.folder[data-id="${id}"]`);
const openIds = (options) => options.$$eval('.folder', (all) => all.filter((d) => d.open).map((d) => d.dataset.id));
const titlesIn = (locator) => locator.locator(':scope > .folder__list > li[data-key] [data-field="title"]').allTextContents();

await check('settings page: folders view by default, every folder closed, with counts', async () => {
  const options = await optionsPage(null);
  const view = await options.isChecked('#view-folders');
  const open = await openIds(options);
  const bar = folderOf(options, '1');
  const count = Number(await bar.locator(':scope > summary [data-field="count"]').textContent());
  const inBar = await sw.evaluate(async () => {
    const walk = (n) => (n.url ? (/^https?:/.test(n.url) && n.title.trim() ? 1 : 0) : (n.children ?? []).reduce((a, c) => a + walk(c), 0));
    return walk((await chrome.bookmarks.getSubTree('1'))[0]);
  });
  await options.close();
  if (!view || open.length || count !== inBar) throw new Error(JSON.stringify({ view, open, count, inBar }));
});
await check('settings page: "How it works" is closed by default and opens on click', async () => {
  const options = await optionsPage(null);
  const before = await options.isVisible('#how [data-i18n="howIntro"]');
  await options.click('#how > summary');
  const after = await options.isVisible('#how [data-i18n="howIntro"]');
  await options.close();
  if (before || !after) throw new Error(JSON.stringify({ before, after }));
});
await check('settings page: open folders are remembered', async () => {
  const options = await optionsPage(null);
  await folderOf(options, '1').locator(':scope > summary').click();
  await folderOf(options, work.folder).locator(':scope > summary').click();
  await options.waitForTimeout(200);
  await options.reload();
  await options.waitForSelector('#tree .folder');
  const open = await openIds(options);
  await options.close();
  if (!open.includes('1') || !open.includes(work.folder) || open.includes(work.deep)) throw new Error(JSON.stringify(open));
});
await check('settings page: search shows only folders with matches, open, and keeps the remembered ones', async () => {
  const options = await optionsPage({ mode: 'folders', sort: 'browser', open: ['1'] });
  await options.fill('#search', 'deep one');
  await options.waitForTimeout(200);
  const shown = await options.$$eval('#tree .folder', (all) => all.map((d) => [d.dataset.id, d.open]));
  const rows = await options.locator('#tree li[data-key] [data-field="title"]').allTextContents();
  await options.fill('#search', '');
  await options.waitForTimeout(200);
  const after = await openIds(options);
  await options.close();
  const expected = JSON.stringify([['1', true], [work.folder, true], [work.deep, true]]);
  if (JSON.stringify(shown) !== expected || rows.join() !== 'Deep one' || after.join() !== '1') {
    throw new Error(JSON.stringify({ shown, rows, after }));
  }
});
await check('settings page: filter by scope, with counts', async () => {
  await sw.evaluate((k) => chrome.storage.sync.set({ [k]: { scope: 'host' } }), `scope:${base.slice(7)}/work/a`);
  const options = await optionsPage({ mode: 'folders', sort: 'browser', open: [] });
  await options.selectOption('#filter', 'host');
  await options.waitForTimeout(200);
  const scopesShown = await options.$$eval('#tree li[data-key]', (rows) => rows.map((r) => r.dataset.scope));
  const titles = await options.locator('#tree li[data-key] [data-field="title"]').allTextContents();
  const label = await options.$eval('#filter option[value="host"]', (o) => o.textContent);
  await options.close();
  if (!titles.includes('Work a') || titles.includes('Work b') || scopesShown.some((x) => x !== 'host') || !/\(\d+\)$/.test(label)) {
    throw new Error(JSON.stringify({ titles, scopesShown, label }));
  }
});
await check('settings page: order within a folder, folders first', async () => {
  const options = await optionsPage({ mode: 'folders', sort: 'browser', open: ['1', work.folder] });
  const folder = folderOf(options, work.folder);
  const browser = await titlesIn(folder);
  await options.selectOption('#sort', 'name');
  await options.waitForTimeout(200);
  const byName = await titlesIn(folderOf(options, work.folder));
  const first = await folderOf(options, work.folder).locator(':scope > .folder__list > li').first().getAttribute('class');
  await options.close();
  if (browser.join() !== 'Work b,Work a' || byName.join() !== 'Work a,Work b' || first !== 'folder__item') {
    throw new Error(JSON.stringify({ browser, byName, first }));
  }
});
await check('settings page: one list, as before, with the folder of each bookmark', async () => {
  const options = await optionsPage({ mode: 'folders', sort: 'browser', open: [] });
  await options.check('#view-list');
  await options.waitForSelector('#list select');
  const tree = await options.isVisible('#tree');
  const where = await options.locator('#list li', { has: options.locator('[data-field="title"]', { hasText: /^Deep one$/ }) }).locator('[data-field="where"]').textContent();
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('optionsView')).optionsView.mode);
  await options.close();
  if (tree || !where.endsWith('Work › Deep') || stored !== 'list') throw new Error(JSON.stringify({ tree, where, stored }));
});
await check('settings page: ?edit= opens the folders above the bookmark', async () => {
  const options = await optionsPage({ mode: 'folders', sort: 'browser', open: [] }, `?edit=${work.one}`);
  const row = options.locator(`li[data-id="${work.one}"]`);
  await row.locator('[data-field="text"]').waitFor();
  const scope = await row.locator('select').inputValue();
  await options.close();
  await sw.evaluate((k) => chrome.storage.sync.remove(k), `scope:${base.slice(7)}/work/deep`);
  if (scope !== 'contains') throw new Error(scope);
});
await check('settings file: export, then import applies the settings to every bookmark with the same address', async () => {
  const workA = `${base.slice(7)}/work/a`;
  const workB = `${base.slice(7)}/work/b`;
  await sw.evaluate(([a, b]) => chrome.storage.sync.set({ [`scope:${a}`]: { scope: 'host' }, [`title:${b}`]: true }), [workA, workB]);
  const options = await optionsPage();
  const [download] = await Promise.all([options.waitForEvent('download'), options.click('#export')]);
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  const exported = file.bookmarks.find((e) => e.address === workA);
  const name = download.suggestedFilename();
  // Gone from this browser; a second bookmark of the same address, elsewhere and under another name.
  await sw.evaluate(([a, b]) => chrome.storage.sync.remove([`scope:${a}`, `title:${b}`]), [workA, workB]);
  await sw.evaluate((u) => chrome.bookmarks.create({ parentId: '2', title: 'Work a copy', url: u }), `${base}/work/a/`);
  await options.reload();
  await options.waitForSelector('#list select');
  await options.setInputFiles('#import-file', await download.path());
  await options.waitForSelector('#import-review:not([hidden])');
  const summary = await options.textContent('#import-summary');
  await options.click('#import-apply');
  await options.waitForSelector('#backup-status-row:not([hidden])');
  const status = await options.textContent('#backup-status');
  const copy = options.locator('#list li', { has: options.locator('[data-field="title"]', { hasText: /^Work a copy$/ }) });
  const scope = await copy.locator('select').inputValue();
  const restored = await sw.evaluate(([a, b]) => chrome.storage.sync.get([`scope:${a}`, `title:${b}`]), [workA, workB]);
  await options.close();
  await sw.evaluate((b) => chrome.storage.sync.remove(`title:${b}`), workB);
  const ok =
    /^bookmark-tab-title-settings-\d{4}-\d{2}-\d{2}\.json$/.test(name) &&
    exported?.name === 'Work a' &&
    exported.scope === 'host' &&
    /\d/.test(summary) &&
    status.includes(String(file.bookmarks.length)) &&
    scope === 'host' &&
    restored[`scope:${workA}`]?.scope === 'host' &&
    restored[`title:${workB}`] === true;
  if (!ok) throw new Error(JSON.stringify({ name, exported, summary, status, scope, restored }));
});
await check('settings file: a bookmark exported with "only this address" gets it back on import', async () => {
  const key = `${base.slice(7)}/work/b`;
  const options = await optionsPage();
  const [download] = await Promise.all([options.waitForEvent('download'), options.click('#export')]);
  const row = options.locator('#list li', { has: options.locator('[data-field="title"]', { hasText: /^Work b$/ }) });
  await row.locator('select').selectOption('host');
  await options.waitForTimeout(200);
  await options.setInputFiles('#import-file', await download.path());
  await options.click('#import-apply');
  await options.waitForSelector('#backup-status-row:not([hidden])');
  await options.waitForTimeout(200);
  const scope = await row.locator('select').inputValue();
  const stored = await sw.evaluate((k) => chrome.storage.sync.get(k), `scope:${key}`);
  await options.close();
  if (scope !== 'exact' || Object.keys(stored).length) throw new Error(JSON.stringify({ scope, stored }));
});
await check('settings file: turned off, for all bookmarks and for one, goes into the file and comes back', async () => {
  const off = `off:${base.slice(7)}/work/a`;
  await sw.evaluate((k) => chrome.storage.sync.set({ disabled: true, [k]: true }), off);
  const options = await optionsPage();
  const [download] = await Promise.all([options.waitForEvent('download'), options.click('#export')]);
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  await sw.evaluate((k) => chrome.storage.sync.remove(['disabled', k]), off);
  await options.waitForTimeout(200);
  const before = await options.isChecked('#on-all');
  await options.setInputFiles('#import-file', await download.path());
  const summary = await options.textContent('#import-summary');
  await options.click('#import-apply');
  await options.waitForSelector('#backup-status-row:not([hidden])');
  await options.waitForTimeout(200);
  const after = await options.isChecked('#on-all');
  const restored = await sw.evaluate((k) => chrome.storage.sync.get(['disabled', k]), off);
  await sw.evaluate((k) => chrome.storage.sync.remove(['disabled', k]), off);
  await options.close();
  const entry = file.bookmarks.find((e) => e.address === off.slice(4));
  const ok = file.onForAll === false && entry?.on === false && before && !after && restored.disabled === true && restored[off] === true && summary.includes('off');
  if (!ok) throw new Error(JSON.stringify({ onForAll: file.onForAll, entry, before, after, restored, summary }));
});
await check('settings file: another file is refused and nothing changes', async () => {
  const before = await sw.evaluate(() => chrome.storage.sync.get(null));
  const options = await optionsPage();
  await options.setInputFiles('#import-file', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await options.waitForSelector('#backup-status-row:not([hidden])');
  const error = await options.$eval('#backup-status', (p) => p.classList.contains('tone-danger'));
  const review = await options.isVisible('#import-review');
  await options.close();
  const after = await sw.evaluate(() => chrome.storage.sync.get(null));
  if (!error || review || JSON.stringify(before) !== JSON.stringify(after)) throw new Error(JSON.stringify({ error, review }));
});
const appendSwitch = async (on) => {
  const options = await optionsPage();
  if ((await options.isChecked('#append-page-title')) !== on) await options.click('#append-page-title');
  await options.waitForTimeout(200);
  const checked = await options.isChecked('#append-page-title');
  await options.close();
  if (checked !== on) throw new Error(`switch is ${checked}`);
};
await check('page title option is off by default', async () => {
  const options = await optionsPage();
  const checked = await options.isChecked('#append-page-title');
  await options.close();
  if (checked) throw new Error('switched on');
});
await check('page title option on → "bookmark name — page title", following the page', async () => {
  const mail = await context.newPage();
  await mail.goto(`${base}/dyn`);
  await expectTitle(mail, 'Mail');
  await appendSwitch(true);
  await expectTitleLike(mail, /^Mail — \(\d+\) Inbox$/);
  const first = await mail.title();
  await mail.waitForTimeout(300);
  await expectTitleLike(mail, /^Mail — \(\d+\) Inbox$/, 200);
  if ((await mail.title()) === first) throw new Error('the page title did not follow the page');
  await mail.close();
});
await check('page title option: a page that edits its current title does not repeat the name', async () => {
  await bookmark.create('Pre', `${base}/prefix`);
  const pre = await context.newPage();
  await pre.goto(`${base}/prefix`);
  for (let i = 0; i < 10; i++) {
    await pre.waitForTimeout(150);
    await expectTitleLike(pre, /^Pre — \(\d+\) Prefix$/, 500);
  }
  await pre.close();
});
await check('page title option off again → only the bookmark name', async () => {
  const mail = await context.newPage();
  await mail.goto(`${base}/dyn`);
  await expectTitleLike(mail, /^Mail — /);
  await appendSwitch(false);
  await expectTitle(mail, 'Mail');
  await mail.close();
});
await check('page title per bookmark (popup) overrides the option for every bookmark', async () => {
  const mail = await context.newPage();
  await mail.goto(`${base}/dyn`);
  const pre = await context.newPage();
  await pre.goto(`${base}/prefix`);
  await expectTitle(mail, 'Mail');
  const popup = await popupFor(`${base}/dyn`);
  const before = await popup.isChecked('#page-title');
  await popup.click('#page-title');
  await popup.waitForTimeout(200);
  await popup.close();
  await expectTitleLike(mail, /^Mail — \(\d+\) Inbox$/);
  await expectTitle(pre, 'Pre');
  // On for every bookmark, off for this one.
  await appendSwitch(true);
  await expectTitleLike(pre, /^Pre — /);
  const again = await popupFor(`${base}/dyn`);
  const shown = await again.isChecked('#page-title');
  await again.click('#page-title');
  await again.waitForTimeout(200);
  await again.close();
  await expectTitle(mail, 'Mail');
  await mail.close();
  await pre.close();
  if (before || !shown) throw new Error(JSON.stringify({ before, shown }));
});
await check('page title per bookmark (settings row) shows the choice and changes it', async () => {
  const mail = await context.newPage();
  await mail.goto(`${base}/dyn`);
  const [options, row] = await optionsRow('Mail');
  const off = await row.locator('[data-field="page-title"]').isChecked();
  const preOn = await optionsRow('Pre').then(async ([o, r]) => (await r.locator('[data-field="page-title"]').isChecked()) && (await o.close(), true));
  await row.locator('[data-field="page-title"]').click();
  await options.waitForTimeout(200);
  await options.close();
  await expectTitleLike(mail, /^Mail — /);
  await mail.close();
  const own = await sw.evaluate(async () => Object.keys(await chrome.storage.sync.get(null)).filter((k) => k.startsWith('title:')));
  await appendSwitch(false);
  if (off || !preOn || own.length) throw new Error(JSON.stringify({ off, preOn, own }));
});
await check('page title with markup in it: only its text is added', async () => {
  await bookmark.create('Mk', `${base}/markup`);
  await sw.evaluate((k) => chrome.storage.sync.set({ [k]: true }), `title:${base.slice(7)}/markup`);
  const mk = await context.newPage();
  await mk.goto(`${base}/markup`);
  await expectTitle(mk, 'Mk — E4 Admin & more');
  await sw.evaluate((k) => chrome.storage.sync.remove(k), `title:${base.slice(7)}/markup`);
  await expectTitle(mk, 'Mk');
  await mk.close();
});
await check('page title that has the bookmark name in it shows the name once', async () => {
  await bookmark.create('Nm', `${base}/named`);
  await bookmark.create('Rs', `${base}/restore`);
  await sw.evaluate((k) => chrome.storage.sync.set(Object.fromEntries(k.map((x) => [x, true]))), [`title:${base.slice(7)}/named`, `title:${base.slice(7)}/restore`]);
  const nm = await context.newPage();
  await nm.goto(`${base}/named`);
  await expectTitle(nm, 'Nm — Admin');
  const rs = await context.newPage();
  await rs.goto(`${base}/restore`);
  await expectTitle(rs, 'Rs — Restore');
  await rs.waitForTimeout(1500);
  await expectTitle(rs, 'Rs — Restore', 200);
  await sw.evaluate((k) => chrome.storage.sync.remove(k), [`title:${base.slice(7)}/named`, `title:${base.slice(7)}/restore`]);
  await nm.close();
  await rs.close();
});
await check('turned off for all bookmarks: tabs show the page titles, the button says OFF, the popup still works', async () => {
  const mail = await context.newPage();
  await mail.goto(`${base}/onoff`);
  await bookmark.create('On off named', `${base}/onoff`);
  await expectTitle(mail, 'On off named');
  const options = await optionsPage();
  await options.click('#on-all');
  await options.waitForTimeout(200);
  await options.close();
  await expectTitle(mail, 'On off');
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  const popup = await popupFor(`${base}/onoff`);
  const shown = [await popup.inputValue('#name'), await popup.isChecked('#on-all'), await popup.textContent('#shown-because')];
  await popup.click('#on-all');
  await popup.waitForTimeout(200);
  await popup.close();
  await expectTitle(mail, 'On off named');
  const after = await sw.evaluate(() => chrome.action.getBadgeText({}));
  await mail.close();
  if (badge !== 'OFF' || after !== '' || shown[0] !== 'On off named' || shown[1] || !shown[2]) throw new Error(JSON.stringify({ badge, after, shown }));
});
await check('turned off for one bookmark (popup): the page title, and the popup keeps that bookmark to turn it on', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/onoff`);
  await expectTitle(p, 'On off named');
  const popup = await popupFor(`${base}/onoff`);
  await popup.click('#bookmark-on');
  await popup.waitForTimeout(200);
  await popup.close();
  await expectTitle(p, 'On off');
  const again = await popupFor(`${base}/onoff`);
  const state = [await again.inputValue('#name'), await again.isChecked('#bookmark-on'), await again.isVisible('#shown-because')];
  await again.click('#bookmark-on');
  await again.waitForTimeout(200);
  await again.close();
  await expectTitle(p, 'On off named');
  await p.close();
  if (state[0] !== 'On off named' || state[1] || !state[2]) throw new Error(JSON.stringify(state));
});
await check('turned off for one bookmark (settings row): shown under "Turned off", and its scope reaches no page', async () => {
  const [options, row] = await optionsRow('E');
  await row.locator('select').selectOption('host');
  await row.locator('[data-field="on"]').click();
  await options.waitForTimeout(200);
  await options.selectOption('#filter', 'off');
  await options.waitForTimeout(200);
  const titles = await options.locator('#list li[data-key] [data-field="title"]').allTextContents();
  await options.close();
  await scoped.goto(E);
  await scoped.waitForTimeout(400);
  await expectTitle(scoped, 'Page /s/');
  await scoped.goto(`${L}/s/b`);
  await scoped.waitForTimeout(400);
  await expectTitle(scoped, 'Page /s/b');
  const [o2, r2] = await optionsRow('E');
  await r2.locator('[data-field="on"]').click();
  await r2.locator('select').selectOption('exact');
  await o2.waitForTimeout(200);
  await o2.close();
  if (titles.join() !== 'E') throw new Error(JSON.stringify(titles));
});
await check('context menu has one item per scope (clicking native menus is not scriptable)', async () => {
  // update() rejects for an unknown menu id.
  await sw.evaluate(() => Promise.all(['exact', 'below', 'contains', 'host'].map((s) => chrome.contextMenus.update(`scope-${s}`, {}))));
});
await check('another tab without a bookmark is not affected', async () => {
  const other = await context.newPage();
  await other.goto(`${base}/attacker`);
  await other.waitForTimeout(500);
  await expectTitle(other, 'Attacker');
  await other.close();
});
// After an extension update the old copy of the script stays in the tab, cut off from the extension, next to the
// new copy. Playwright cannot bring a reloaded extension back, so both copies of the real script run here with a
// stand-in for chrome.runtime each, on a page without a bookmark (the extension itself leaves it alone).
await check('after an extension update the old copy of the script does not take the page title away', async () => {
  const source = fs.readFileSync(path.join(EXT_DIR, 'src/content.js'), 'utf8');
  const up = await context.newPage();
  await up.goto(`${base}/upd`);
  await up.evaluate((src) => {
    const copy = (reply) => {
      const chrome = { runtime: { id: 'ext', sendMessage: async () => reply, onMessage: { addListener: (fn) => (chrome.listener = fn) } } };
      new Function('chrome', src)(chrome);
      return chrome;
    };
    window.oldCopy = copy({ title: 'Up', append: false });
    window.copy = copy;
  }, source);
  await expectTitle(up, 'Up');
  await up.evaluate(() => {
    window.oldCopy.runtime.id = undefined;
    window.newCopy = window.copy({ title: 'Up', append: false });
  });
  await up.waitForTimeout(100);
  await up.evaluate(() => window.newCopy.listener({ type: 'set-title', title: 'Up', append: true }));
  await expectTitle(up, 'Up — Admin page');
  // Another change in <head>, then the bookmark is gone: the page gets its own title back.
  await up.evaluate(() => document.head.append(Object.assign(document.createElement('meta'), { name: 'x' })));
  await up.waitForTimeout(200);
  await up.evaluate(() => window.newCopy.listener({ type: 'set-title', title: null }));
  await expectTitle(up, 'Admin page');
  await up.close();
});

await context.close();
server.close();
server2.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

for (const [ok, name] of results) console.log(`${ok ? '✔' : '✘'} ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
