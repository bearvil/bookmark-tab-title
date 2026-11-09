import { buildIndex, findTitle, originOf, siteOf } from './match.js';

let indexPromise = null;

function getIndex() {
  indexPromise ??= chrome.bookmarks.getTree().then(buildIndex);
  return indexPromise;
}

// URLs the tab's current page was really loaded from: the committed URL and, after a completed same-site server
// redirect, the URL before it (bookmark "example.com" → "example.com/login"). They keep the bookmark name through
// in-page (SPA) navigation, while a page can never borrow the name of another site's bookmark.
// Kept in storage.session because the service worker shuts down when idle.
const pendingKey = (tabId) => `pending:${tabId}`;
const loadKey = (tabId) => `load:${tabId}`;

async function take(key) {
  const value = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.remove(key);
  return value;
}

async function titleFor(tab) {
  if (!tab?.url) return null;
  const key = loadKey(tab.id);
  const load = (await chrome.storage.session.get(key))[key];
  // In-page navigation keeps the origin of the loaded page; anything else is a different page.
  const loaded = load && originOf(tab.url) === load.origin ? load.urls : [];
  return findTitle(await getIndex(), tab.url, ...loaded);
}

async function pushTitle(tab) {
  const title = await titleFor(tab);
  chrome.tabs.sendMessage(tab.id, { type: 'set-title', title }, { frameId: 0 }).catch(() => {});
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map(pushTitle));
}

function onBookmarksChanged() {
  indexPromise = null;
  refreshAllTabs();
}

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
  // The content script may have asked before the redirect was stored.
  chrome.tabs.get(tabId).then(pushTitle, () => {});
});

// SPA (history.pushState): the page does not reload, so the content script will not ask by itself.
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId === 0) chrome.tabs.get(tabId).then(pushTitle, () => {});
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([pendingKey(tabId), loadKey(tabId)]));

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onImportEnded.addListener(onBookmarksChanged);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'get-title' || !sender.tab || sender.frameId !== 0) return;
  titleFor(sender.tab).then((title) => sendResponse({ title }));
  return true;
});

// Tabs opened before installation, and tabs whose content script was orphaned by an update, need a fresh copy.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] }).catch(() => {});
  }
});
