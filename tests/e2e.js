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
const extensionId = new URL(sw.url()).host;
const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
const popupFor = async (url) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html?tab=${await tabIdOf(url)}`);
  await popup.waitForTimeout(300);
  return popup;
};
const optionsPage = async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.waitForSelector('#list select');
  return options;
};

// Scope tests run on another host name of the same server ("localhost"), so the bookmarks above do not interfere.
// E = /s/ and A = /s/a are the e.com and e.com/a of the use-case analysis.
const L = `http://localhost:${server.address().port}`;
const E = `${L}/s/`;
const A = `${L}/s/a`;
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

await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

for (const [ok, name] of results) console.log(`${ok ? '✔' : '✘'} ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
