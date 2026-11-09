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
  const html = routes[pathname];
  res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(html ?? 'not found');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

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
await check('another tab without a bookmark is not affected', async () => {
  const other = await context.newPage();
  await other.goto(`${base}/landing`);
  await other.waitForTimeout(500);
  await expectTitle(other, 'Landing');
  await other.close();
});

await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

for (const [ok, name] of results) console.log(`${ok ? '✔' : '✘'} ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
