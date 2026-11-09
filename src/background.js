import { buildIndex, findBookmark, hostOf, originOf, siteOf } from './match.js';
import { getKeepOnHost, onKeepOnHostChanged, setKeepOnHost } from './settings.js';

const WEB_PAGES = ['http://*/*', 'https://*/*'];
const MENU_ID = 'keep-on-host';

let indexPromise = null;

function getIndex() {
  indexPromise ??= chrome.bookmarks.getTree().then(buildIndex);
  return indexPromise;
}

// Per-tab state, in storage.session because the service worker shuts down when idle:
// - load: URLs the current page was really loaded from — the committed URL and, after a completed same-site server
//   redirect, the URL before it (bookmark "example.com" → "example.com/login"). They keep the bookmark name through
//   in-page (SPA) navigation, while a page can never borrow the name of another site's bookmark.
// - anchor: the bookmark the tab last showed and its host. With "keep on whole host" switched on for that bookmark,
//   the name stays on every page of that host until the tab leaves it.
const pendingKey = (tabId) => `pending:${tabId}`;
const loadKey = (tabId) => `load:${tabId}`;
const anchorKey = (tabId) => `anchor:${tabId}`;

async function sessionGet(key) {
  return (await chrome.storage.session.get(key))[key];
}

async function take(key) {
  const value = await sessionGet(key);
  await chrome.storage.session.remove(key);
  return value;
}

// What the popup, the context menu and the tab title all work from.
async function tabState(tab) {
  const host = hostOf(tab?.url);
  if (!host || !/^https?:/.test(tab.url)) return { supported: false };
  const index = await getIndex();
  const load = await sessionGet(loadKey(tab.id));
  // In-page navigation keeps the origin of the loaded page; anything else is a different page.
  const loaded = load && originOf(tab.url) === load.origin ? load.urls : [];
  const direct = findBookmark(index, tab.url, ...loaded);
  if (direct) {
    await chrome.storage.session.set({ [anchorKey(tab.id)]: { url: direct.url, host } });
    return { supported: true, host, bookmark: direct, direct: true, keepOnHost: await getKeepOnHost(direct.url) };
  }
  const anchor = await sessionGet(anchorKey(tab.id));
  if (anchor && anchor.host !== host) await chrome.storage.session.remove(anchorKey(tab.id));
  const anchored = anchor?.host === host ? findBookmark(index, anchor.url) : null;
  if (!anchored) return { supported: true, host, bookmark: null };
  return { supported: true, host, bookmark: anchored, direct: false, keepOnHost: await getKeepOnHost(anchored.url) };
}

const titleOf = (state) => (state.bookmark && (state.direct || state.keepOnHost) ? state.bookmark.title : null);

async function pushTitle(tab) {
  const title = titleOf(await tabState(tab));
  chrome.tabs.sendMessage(tab.id, { type: 'set-title', title }, { frameId: 0 }).catch(() => {});
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  await Promise.all(tabs.map(pushTitle));
  updateMenu();
}

function onBookmarksChanged() {
  indexPromise = null;
  refreshAllTabs();
}

// --- Context menu (C): mirrors the active tab, like the popup.

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      type: 'checkbox',
      title: chrome.i18n.getMessage('menuKeepOnHost', ['…']),
      contexts: ['page'],
      documentUrlPatterns: WEB_PAGES,
      visible: false,
    });
  });
}

async function updateMenu() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const state = tab ? await tabState(tab) : { supported: false };
  const visible = Boolean(state.bookmark);
  const props = visible
    ? { visible, checked: state.keepOnHost, title: chrome.i18n.getMessage('menuKeepOnHost', [state.host]) }
    : { visible };
  chrome.contextMenus.update(MENU_ID, props).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  const state = await tabState(tab);
  if (state.bookmark) await setKeepOnHost(state.bookmark.url, info.checked);
});

chrome.tabs.onActivated.addListener(() => updateMenu());
chrome.windows.onFocusChanged.addListener(() => updateMenu());
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.url || change.status === 'complete')) updateMenu();
});

// --- Navigation tracking.

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && tabId >= 0) chrome.storage.session.set({ [pendingKey(tabId)]: url });
});

// Aborted or failed navigations never count (e.g. a page starting a load of a bookmarked URL and stopping it).
chrome.webNavigation.onErrorOccurred.addListener(({ tabId, frameId }) => {
  if (frameId === 0 && tabId >= 0) chrome.storage.session.remove(pendingKey(tabId));
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url, transitionQualifiers }) => {
  if (frameId !== 0 || tabId < 0) return;
  const from = await take(pendingKey(tabId));
  const redirected = from && from !== url && transitionQualifiers.includes('server_redirect');
  const urls = redirected && siteOf(from) === siteOf(url) ? [url, from] : [url];
  await chrome.storage.session.set({ [loadKey(tabId)]: { origin: originOf(url), urls } });
  // The content script may have asked before the load was stored.
  chrome.tabs.get(tabId).then(pushTitle, () => {});
});

// SPA (history.pushState): the page does not reload, so the content script will not ask by itself.
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId === 0) chrome.tabs.get(tabId).then(pushTitle, () => {});
});

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.storage.session.remove([pendingKey(tabId), loadKey(tabId), anchorKey(tabId)]),
);

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onImportEnded.addListener(onBookmarksChanged);
onKeepOnHostChanged(refreshAllTabs);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'get-title' && sender.tab && sender.frameId === 0) {
    tabState(sender.tab).then((state) => sendResponse({ title: titleOf(state) }));
    return true;
  }
  // From the popup: only the extension's own pages may ask for a tab's state.
  if (msg?.type === 'tab-state' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    chrome.tabs.get(msg.tabId).then(tabState, () => ({ supported: false })).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  createMenu();
  updateMenu();
  // Tabs opened before installation, and tabs whose content script was orphaned by an update, need a fresh copy.
  if (reason !== 'install' && reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] }).catch(() => {});
  }
});

// Context menu items survive browser restarts, but their per-tab state does not.
chrome.runtime.onStartup.addListener(() => updateMenu());
