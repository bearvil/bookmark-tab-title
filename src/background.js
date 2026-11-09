import { buildIndex, findTitle } from './match.js';

let indexPromise = null;

function getIndex() {
  indexPromise ??= chrome.bookmarks.getTree().then(buildIndex);
  return indexPromise;
}

// The URL a navigation started from, before any redirect (bookmark "example.com" → "example.com/login").
// Kept in storage.session because the service worker shuts down when idle.
const startKey = (tabId) => `start:${tabId}`;

async function getStartUrl(tabId) {
  const key = startKey(tabId);
  return (await chrome.storage.session.get(key))[key];
}

async function titleFor(tab) {
  if (!tab?.url) return null;
  return findTitle(await getIndex(), tab.url, await getStartUrl(tab.id));
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
  if (frameId === 0 && tabId >= 0) chrome.storage.session.set({ [startKey(tabId)]: url });
});

// SPA (history.pushState): the page does not reload, so the content script will not ask by itself.
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId === 0) chrome.tabs.get(tabId).then(pushTitle, () => {});
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(startKey(tabId)));

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onImportEnded.addListener(onBookmarksChanged);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'get-title' || !sender.tab || sender.frameId !== 0) return;
  titleFor(sender.tab).then((title) => sendResponse({ title }));
  return true;
});

// Tabs opened before installation have no content script.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] }).catch(() => {});
  }
});
