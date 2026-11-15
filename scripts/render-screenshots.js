// Renders the extra Chrome Web Store screenshots (1280x800) from the real extension UI.
//
// Usage: node scripts/render-screenshots.js [part of an output name, e.g. popup]
//
// Loads the extension in Playwright Chromium with a throwaway profile and sample bookmarks,
// serves the sample pages locally through request routing (no network), captures the popup
// and the settings page as they really look, and places them on a frame in the style of
// store/screenshot-1280x800.svg. The right-click menu is drawn, with its texts taken from
// _locales/en. Fonts come from fonts/, so nothing is downloaded.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];
const W = 1280;
const H = 800;

const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));
const msg = (key, ...subs) => {
  let text = messages[key].message;
  for (const [name, def] of Object.entries(messages[key].placeholders ?? {})) {
    const value = subs[Number(def.content.replace('$', '')) - 1] ?? '';
    text = text.replaceAll(`$${name.toUpperCase()}$`, value);
  }
  return text;
};

const font = (file) => fs.readFileSync(path.join(root, 'fonts', file)).toString('base64');
const fontFaces = `
  @font-face { font-family: 'Nunito'; font-weight: 400 800; src: url(data:font/woff2;base64,${font('nunito-latin.woff2')}) format('woff2'); }
  @font-face { font-family: 'Nunito'; font-weight: 400 800; src: url(data:font/woff2;base64,${font('nunito-latin-ext.woff2')}) format('woff2'); unicode-range: U+0100-02BA, U+1E00-1EFF; }`;
const iconSvg = fs.readFileSync(path.join(root, 'icons/icon-toolbar.svg'), 'utf8');
const dataUri = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// --- Sample bookmarks and pages ---------------------------------------------------------------

// Work comes first so its open folder is what the settings screenshot shows.
const BOOKMARKS = [
  {
    folder: 'Work',
    children: [
      { title: 'Team wiki', url: 'https://wiki.example.com/', page: 'Home – Wiki' },
      { title: 'Apollo board', url: 'https://board.example.com/projects/apollo', page: 'Board' },
      { title: 'Calendar', url: 'https://calendar.example.com/', page: 'Calendar – Week 46' },
      { title: 'Expenses', url: 'https://finance.example.com/expenses', page: 'Finance' },
    ],
  },
  { title: 'Mail – work', url: 'https://mail.example.com/inbox', page: 'Inbox (3) – Mail' },
  { title: 'Sales dashboard', url: 'https://dash.example.com/sales', page: 'Dashboard' },
  { title: 'Ops dashboard', url: 'https://dash.example.com/ops', page: 'Dashboard' },
  {
    folder: 'Reading',
    children: [
      { title: 'Recipes to try', url: 'https://recipes.example.org/saved', page: 'Saved items' },
      { title: 'Local news', url: 'https://news.example.org/', page: 'News' },
    ],
  },
];
const flat = BOOKMARKS.flatMap((b) => b.children ?? [b]);
const pageHtml = (title) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1></body></html>`;

// --- Capture the real UI ----------------------------------------------------------------------

async function capture() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btt-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    // Captured at 2x so the UI stays sharp when the frame scales it down.
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    await context.route(/^https:\/\/[a-z]+\.example\.(com|org)\//, (route) => {
      const url = new URL(route.request().url());
      const hit = flat.find((b) => url.href.startsWith(b.url));
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(hit?.page ?? 'Page') });
    });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    for (let i = 0; !(await sw.evaluate(() => !!globalThis.chrome?.bookmarks).catch(() => false)); i++) {
      if (i > 100) throw new Error('extension APIs never became ready');
      await new Promise((r) => setTimeout(r, 50));
    }
    await sw.evaluate(async (tree) => {
      for (const item of tree) {
        if (!item.folder) {
          await chrome.bookmarks.create({ parentId: '1', title: item.title, url: item.url });
          continue;
        }
        const folder = await chrome.bookmarks.create({ parentId: '1', title: item.folder });
        for (const child of item.children) await chrome.bookmarks.create({ parentId: folder.id, title: child.title, url: child.url });
      }
    }, BOOKMARKS);
    const extensionId = new URL(sw.url()).host;
    const base = `chrome-extension://${extensionId}/src`;

    const tabs = {};
    for (const b of flat.slice(0, 5)) {
      const tab = await context.newPage();
      await tab.goto(b.url);
      tabs[b.url] = tab;
    }
    const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);

    // Set a few scopes through the popup itself, as a user would.
    const scopeVia = async (url, scope) => {
      const popup = await context.newPage();
      await popup.goto(`${base}/popup/popup.html?tab=${await tabIdOf(url)}`);
      await popup.waitForSelector('#state-bookmark:not([hidden])');
      await popup.check(`[name="scope"][value="${scope}"]`);
      await popup.waitForTimeout(400);
      await popup.close();
    };
    await scopeVia('https://mail.example.com/inbox', 'below');
    await scopeVia('https://wiki.example.com/', 'host');
    await scopeVia('https://board.example.com/projects/apollo', 'contains');

    const shots = {};
    const popupShot = async (scheme) => {
      const popup = await context.newPage();
      await popup.emulateMedia({ colorScheme: scheme });
      await popup.setViewportSize({ width: 400, height: 800 });
      await popup.goto(`${base}/popup/popup.html?tab=${await tabIdOf('https://mail.example.com/inbox')}`);
      await popup.waitForSelector('#state-bookmark:not([hidden])');
      await popup.evaluate(() => document.fonts.ready);
      await popup.waitForTimeout(300);
      const box = await popup.locator('body').boundingBox();
      const image = await popup.screenshot({ clip: { x: 0, y: 0, width: box.width, height: box.height } });
      await popup.close();
      return { image, width: box.width, height: box.height };
    };
    shots.popupDark = await popupShot('dark');
    shots.popupLight = await popupShot('light');

    // Settings page: folders view with the Work folder open, page title added for one bookmark, one turned off.
    const folderIds = await sw.evaluate(async () => {
      const [rootNode] = await chrome.bookmarks.getTree();
      return ['1', ...rootNode.children[0].children.filter((n) => n.title === 'Work').map((n) => n.id)];
    });
    await sw.evaluate((open) => chrome.storage.local.set({ optionsView: { mode: 'folders', sort: 'browser', open } }), folderIds);
    const options = await context.newPage();
    await options.setViewportSize({ width: 1040, height: 1400 });
    await options.emulateMedia({ colorScheme: 'dark' });
    await options.goto(`${base}/options/options.html`);
    await options.waitForSelector('#tree .folder');
    await options.evaluate(() => document.fonts.ready);
    const rowOf = (title) => options.locator('li.row--wrap', { has: options.locator('[data-field="title"]', { hasText: title }) });
    await rowOf('Calendar').locator('[data-field="page-title"]').click({ force: true });
    await rowOf('Expenses').locator('[data-field="on"]').click({ force: true });
    await options.waitForTimeout(500);
    await options.locator('#search').blur();
    // The frame starts at the bookmark list, so its rows are what shows.
    const top = Math.max(0, (await options.locator('#tree').boundingBox()).y - 10);
    shots.options = { image: await options.screenshot({ clip: { x: 0, y: top, width: 1040, height: 600 } }), width: 1040, height: 600 };
    await options.close();
    return shots;
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// --- Frames -----------------------------------------------------------------------------------

const frameCss = `
  ${fontFaces}
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: 'Nunito', system-ui, sans-serif; color: #F5F4FB; position: relative;
    background: linear-gradient(135deg, #002E34 0%, #0D2122 20%, #002E34 45%, #144E4E 65%, #093537 85%, #002E34 100%);
  }
  .head { position: absolute; left: 80px; top: 52px; display: flex; gap: 24px; align-items: flex-start; }
  .head svg { width: 64px; height: 64px; flex: none; }
  h1 { margin: 0; font-size: 44px; font-weight: 800; letter-spacing: -1px; line-height: 60px; }
  h1 em { font-style: normal; color: #5EEAD4; }
  .sub { margin: 4px 0 0; font-size: 20px; font-weight: 600; color: #C9DEDC; }
  .window {
    position: absolute; left: 80px; width: 1120px; border-radius: 22px; overflow: hidden;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  }
  .tabs { height: 60px; position: relative; }
  .dots { position: absolute; left: 24px; top: 28px; display: flex; gap: 8px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: rgba(255,255,255,0.22); }
  .tab { position: absolute; top: 12px; height: 48px; width: 260px; display: flex; align-items: center; gap: 12px; padding: 0 22px; font-size: 17px; font-weight: 700; color: #B4CDCB; }
  .tab.active { background: rgba(255,255,255,0.08); border-radius: 14px 14px 0 0; color: #F5F4FB; font-weight: 800; }
  .tab b { width: 16px; height: 16px; border-radius: 5px; flex: none; }
  .tab .x { margin-left: auto; color: rgba(201,222,220,0.7); font-weight: 600; }
  .tab + .sep { position: absolute; top: 24px; width: 1.5px; height: 22px; background: rgba(255,255,255,0.16); }
  .bar { height: 56px; background: rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px; padding: 0 16px 0 24px; }
  .url { flex: 1; height: 36px; border-radius: 18px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; padding: 0 16px 0 24px; font-size: 15px; font-weight: 600; color: #9DB9B7; }
  .url .ribbon { margin-left: auto; }
  .ext { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; }
  .ext.on { background: rgba(94,234,212,0.16); box-shadow: 0 0 0 1.5px #5EEAD4; }
  .ext svg { width: 22px; height: 22px; }
  .body { position: relative; padding: 24px; }
  .sk { border-radius: 6px; background: rgba(255,255,255,0.08); height: 10px; margin-bottom: 12px; }
  .card { border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); padding: 22px 24px; margin-bottom: 16px; }
  .pill { display: inline-block; padding: 4px 14px; border-radius: 15px; font-size: 15px; font-weight: 800; letter-spacing: 0.5px; border: 1px solid; }
  .shot { position: absolute; border-radius: 16px; overflow: hidden; box-shadow: 0 24px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.14); }
  .shot img { display: block; width: 100%; height: 100%; }
`;

const ribbon = `<svg class="ribbon" width="12" height="22" viewBox="0 0 12 22"><path d="M0 0 H12 V22 L6 17 L0 22 Z" fill="#FB8742"/></svg>`;

const head = (title, accent, sub) => `
  <div class="head">${iconSvg}<div><h1>${title} <em>${accent}</em></h1><p class="sub">${sub}</p></div></div>`;

const tabsRow = (tabs) => {
  let x = 100;
  return tabs
    .map((t, i) => {
      const html = `<div class="tab${i === 0 ? ' active' : ''}" style="left:${x}px"><b style="background:${t.color}"></b>${esc(t.title)}${i === 0 ? '<span class="x">✕</span>' : ''}</div>${i > 0 ? `<i class="sep" style="left:${x + 260}px"></i>` : ''}`;
      x += 270;
      return html;
    })
    .join('') + `<div class="tab" style="left:${x}px;width:auto;font-size:22px">+</div>`;
};

const browser = ({ top, height, tabs, url, extOn = false, bodyHtml = '' }) => `
  <div class="window" style="top:${top}px;height:${height}px">
    <div class="tabs"><div class="dots"><i></i><i></i><i></i></div>${tabsRow(tabs)}</div>
    <div class="bar"><div class="url">${esc(url)}${ribbon}</div><div class="ext${extOn ? ' on' : ''}">${iconSvg}</div></div>
    <div class="body">${bodyHtml}</div>
  </div>`;

const skeleton = `
  <div style="display:flex;gap:36px">
    <div style="width:200px"><div class="sk" style="width:200px;height:12px;background:rgba(255,255,255,0.14)"></div><div class="sk" style="width:160px"></div><div class="sk" style="width:180px"></div><div class="sk" style="width:140px"></div><div class="sk" style="width:170px"></div></div>
    <div style="flex:1">
      <div class="card"><div class="sk" style="width:360px;height:12px;background:rgba(255,255,255,0.12)"></div><div class="sk" style="width:560px;margin:0"></div></div>
      <div class="card"><div class="sk" style="width:300px;height:12px;background:rgba(255,255,255,0.12)"></div><div class="sk" style="width:480px;margin:0"></div></div>
      <div class="card"><div class="sk" style="width:340px;height:12px;background:rgba(255,255,255,0.12)"></div><div class="sk" style="width:520px;margin:0"></div></div>
      <div class="card"><div class="sk" style="width:280px;height:12px;background:rgba(255,255,255,0.12)"></div><div class="sk" style="width:440px;margin:0"></div></div>
    </div>
  </div>`;

const mailTabs = [
  { title: 'Mail – work', color: '#7FD6E0' },
  { title: 'Sales dashboard', color: '#FFB783' },
  { title: 'Ops dashboard', color: '#B9A8F0' },
];

function popupFrame(shots) {
  const p = shots.popupDark;
  const scale = Math.min(1, 470 / p.height);
  const w = Math.round(p.width * scale);
  const h = Math.round(p.height * scale);
  return `${head('Rename it from the', 'toolbar', 'Click the icon to edit the bookmark name and choose where the name is used.')}
    ${browser({ top: 180, height: 590, tabs: mailTabs, url: 'mail.example.com/inbox', extOn: true, bodyHtml: skeleton })}
    <div class="shot" style="left:${80 + 1120 - 16 - w}px;top:${180 + 116 + 4}px;width:${w}px;height:${h}px"><img src="${dataUri(p.image)}"></div>`;
}

function menuFrame() {
  const item = (text, extra = '') => `<div class="mi" ${extra}>${text}</div>`;
  const radio = (text, on) =>
    `<div class="mi radio">${on ? '<span class="dot"></span>' : '<span class="dot off"></span>'}${esc(text)}</div>`;
  const menuCss = `
    .menu { position: absolute; background: #2B3436; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 6px 0; box-shadow: 0 18px 40px rgba(0,0,0,0.5); font-size: 16px; font-weight: 600; color: #E8EEEE; }
    .mi { height: 36px; display: flex; align-items: center; gap: 12px; padding: 0 22px 0 18px; white-space: nowrap; }
    .mi.hl { background: rgba(94,234,212,0.18); }
    .mi .arrow { margin-left: auto; padding-left: 28px; color: #C9DEDC; }
    .mi.radio { padding-left: 16px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #5EEAD4; display: grid; place-items: center; flex: none; }
    .dot::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #5EEAD4; }
    .dot.off { border-color: transparent; } .dot.off::after { display: none; }
    .hr { height: 1px; background: rgba(255,255,255,0.12); margin: 6px 0; }
    .mi svg { width: 18px; height: 18px; flex: none; }
    .cursor { position: absolute; }`;
  return `<style>${menuCss}</style>
    ${head('Or right-click the', 'page', 'The same choices are in the page menu, so a change takes one click.')}
    ${browser({ top: 180, height: 590, tabs: mailTabs, url: 'mail.example.com/inbox', bodyHtml: skeleton })}
    <div class="menu" style="left:300px;top:340px;width:300px">
      ${item('Back')}${item('Forward')}${item('Reload')}<div class="hr"></div>
      ${item('Save as…')}${item('Print…')}<div class="hr"></div>
      ${item(`${iconSvg}Bookmark-Tab Title<span class="arrow">›</span>`, 'class="mi hl"')}
      <div class="hr"></div>${item('Inspect')}
    </div>
    <div class="menu" style="left:598px;top:520px">
      ${radio(msg('menuScope_exact'), false)}
      ${radio(msg('menuScope_below'), true)}
      ${radio(msg('menuScope_contains', 'inbox'), false)}
      ${radio(msg('menuScope_host', 'mail.example.com'), false)}
    </div>
    <svg class="cursor" style="left:288px;top:322px" width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function optionsFrame(shots) {
  const o = shots.options;
  // The page is centred at 720 px; the capture starts at its bookmark list.
  return `${head('Every bookmark name in', 'one place', 'Set how far each name reaches, add the page title, or turn a name off.')}
    ${browser({
      top: 180,
      height: 590,
      tabs: [{ title: 'Bookmark-Tab Title', color: '#5EEAD4' }, ...mailTabs.slice(0, 2)],
      url: 'Bookmark-Tab Title › Settings',
      bodyHtml: '',
    })}
    <div style="position:absolute;left:81px;top:${180 + 116}px;width:1118px;height:${590 - 117}px;overflow:hidden;border-radius:0 0 21px 21px">
      <img src="${dataUri(o.image)}" style="display:block;width:1118px">
      <div style="position:absolute;left:0;right:0;bottom:0;height:36px;background:linear-gradient(transparent, rgba(0,46,52,0.9))"></div>
    </div>`;
}

function themesFrame(shots) {
  const d = shots.popupDark;
  const l = shots.popupLight;
  const scale = Math.min(1, 540 / Math.max(d.height, l.height));
  const box = (p) => ({ w: Math.round(p.width * scale), h: Math.round(p.height * scale) });
  const bd = box(d);
  const bl = box(l);
  return `${head('Light or', 'dark', 'Follows the light or dark mode of your system.')}
    <div style="position:absolute;left:660px;top:0;width:620px;height:800px;background:linear-gradient(135deg,#e1efee 0%,#d8e3e2 30%,#cff3e8 70%,#dcebe9 100%);clip-path:polygon(60px 0,100% 0,100% 100%,0 100%);opacity:0.96"></div>
    <span class="pill" style="position:absolute;left:${370 - 40}px;top:184px;color:#5EEAD4;border-color:#5EEAD4;background:rgba(94,234,212,0.12)">DARK</span>
    <span class="pill" style="position:absolute;left:${950 - 40}px;top:184px;color:#00666B;border-color:#00666B;background:rgba(0,102,107,0.08)">LIGHT</span>
    <div class="shot" style="left:${370 - bd.w / 2}px;top:228px;width:${bd.w}px;height:${bd.h}px"><img src="${dataUri(d.image)}"></div>
    <div class="shot" style="left:${950 - bl.w / 2}px;top:228px;width:${bl.w}px;height:${bl.h}px;box-shadow:0 24px 48px rgba(26,20,48,0.22),0 0 0 1px rgba(20,40,60,0.12)"><img src="${dataUri(l.image)}"></div>`;
}

const FRAMES = [
  { out: 'store/screenshot-2-popup-1280x800.png', title: 'Popup', html: popupFrame },
  { out: 'store/screenshot-3-menu-1280x800.png', title: 'Right-click menu', html: menuFrame },
  { out: 'store/screenshot-4-settings-1280x800.png', title: 'Settings page', html: optionsFrame },
  { out: 'store/screenshot-5-themes-1280x800.png', title: 'Light and dark', html: themesFrame },
];

const shots = await capture();
const browserForFrames = await chromium.launch();
try {
  for (const frame of FRAMES.filter((f) => !only || f.out.includes(only))) {
    const page = await browserForFrames.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><title>${frame.title}</title><style>${frameCss}</style></head><body>${frame.html(shots)}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, frame.out), clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log(`${frame.out} (${W}x${H})`);
  }
} finally {
  await browserForFrames.close();
}
