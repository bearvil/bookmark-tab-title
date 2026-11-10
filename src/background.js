import { buildIndex, hostOf, nextTrail, normalizeUrl, originOf, resolve, SCOPES, siteOf, suggestText } from './match.js';
import {
  getAllScopes,
  getAppendPageTitle,
  getTitleOverrides,
  migrateSettings,
  onPageTitleChanged,
  onScopesChanged,
  setScope,
} from './settings.js';

const WEB_PAGES = ['http://*/*', 'https://*/*'];
const MENU_PREFIX = 'scope-';

let indexPromise = null;
let scopesPromise = null;
let appendPromise = null;
let overridesPromise = null;

function getIndex() {
  indexPromise ??= chrome.bookmarks.getTree().then(buildIndex);
  return indexPromise;
}

function getScopes() {
  scopesPromise ??= getAllScopes();
  return scopesPromise;
}

function getAppend() {
  appendPromise ??= getAppendPageTitle();
  return appendPromise;
}

function getOverrides() {
  overridesPromise ??= getTitleOverrides();
  return overridesPromise;
}

// Per-tab state, in storage.session because the service worker shuts down when idle:
// - load: URLs the current page was really loaded from — the committed URL and, after a completed same-site server
//   redirect, the URL before it (bookmark "example.com" → "example.com/login"). They keep the bookmark name through
//   in-page (SPA) navigation, while a page can never borrow the name of another site's bookmark.
// - trail: the bookmarked addresses the tab visited on its current host, for the "below" and "whole host" scopes.
//   Leaving the host starts a new trail; a link opened in a new tab takes the trail of the tab it came from.
const pendingKey = (tabId) => `pending:${tabId}`;
const loadKey = (tabId) => `load:${tabId}`;
const trailKey = (tabId) => `trail:${tabId}`;

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
  const [index, scopes, load, stored] = await Promise.all([
    getIndex(),
    getScopes(),
    sessionGet(loadKey(tab.id)),
    sessionGet(trailKey(tab.id)),
  ]);
  // In-page navigation keeps the origin of the loaded page; anything else is a different page.
  const loaded = load && originOf(tab.url) === load.origin ? load.urls : [];
  const trail = stored?.host === host ? stored : null;
  const found = resolve(index, scopes, { url: tab.url, loaded, trail: trail?.urls ?? [] });
  const next = nextTrail(trail, host, found);
  if (JSON.stringify(next ?? null) !== JSON.stringify(stored ?? null)) {
    await (next ? chrome.storage.session.set({ [trailKey(tab.id)]: next }) : chrome.storage.session.remove(trailKey(tab.id)));
  }
  return { supported: true, host, ...found, direct: found.via === 'address' };
}

const titleOf = (state) => state.bookmark?.title ?? null;

// What the content script needs: the bookmark name, and whether the page's own title goes after it (the
// bookmark's own choice, else the option for every bookmark).
async function titleMessage(tab) {
  const [state, all, overrides] = await Promise.all([tabState(tab), getAppend(), getOverrides()]);
  const own = state.bookmark ? overrides.get(normalizeUrl(state.bookmark.url)) : undefined;
  return { title: titleOf(state), append: own ?? all };
}

async function pushTitle(tab) {
  const message = await titleMessage(tab);
  chrome.tabs.sendMessage(tab.id, { type: 'set-title', ...message }, { frameId: 0 }).catch(() => {});
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  await Promise.all(tabs.map(pushTitle));
  updateMenu();
}

// Many changes can come at once (an import, the first sync on a new device, a folder deleted): they are refreshed
// once, a moment after the last one, and not at all while an import is still running.
const REFRESH_DELAY_MS = 300;
let refreshTimer = null;
let importing = false;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!importing) refreshTimer = setTimeout(refreshAllTabs, REFRESH_DELAY_MS);
}

function onBookmarksChanged() {
  indexPromise = null;
  scheduleRefresh();
}

function onSettingsChanged() {
  scopesPromise = null;
  appendPromise = null;
  overridesPromise = null;
  scheduleRefresh();
}

// --- Context menu (C): one radio item per scope, mirroring the active tab like the popup.

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    for (const scope of SCOPES) {
      chrome.contextMenus.create({
        id: MENU_PREFIX + scope,
        type: 'radio',
        title: chrome.i18n.getMessage(`menuScope_${scope}`, ['…']),
        contexts: ['page'],
        documentUrlPatterns: WEB_PAGES,
        visible: false,
      });
    }
  });
}

// The saved text, or a suggestion while "contains" is not chosen yet.
const containsText = (state) => (state.scope === 'contains' ? state.text : suggestText(state.bookmark.url));

async function updateMenu() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const state = tab ? await tabState(tab) : { supported: false };
  for (const scope of SCOPES) {
    const visible = Boolean(state.bookmark);
    const subject = scope === 'contains' ? visible && containsText(state) : state.host;
    const title = chrome.i18n.getMessage(subject ? `menuScope_${scope}` : 'menuScope_containsEmpty', [subject || '']);
    const props = visible ? { visible, title, checked: state.scope === scope } : { visible };
    chrome.contextMenus.update(MENU_PREFIX + scope, props).catch(() => {});
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const scope = String(info.menuItemId).slice(MENU_PREFIX.length);
  if (!SCOPES.includes(scope) || !tab) return;
  const state = await tabState(tab);
  if (!state.bookmark) return;
  if (scope !== 'contains') return setScope(state.bookmark.url, scope);
  const text = containsText(state);
  // Nothing to suggest (a bookmark of the home page): let the person type the text.
  if (!text) return chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html?edit=${state.bookmark.id}`) });
  setScope(state.bookmark.url, 'contains', text);
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
  // Leaving the host ends the trail, also through a page the extension does not run on (file:, data:, …).
  const trail = await sessionGet(trailKey(tabId));
  if (trail && trail.host !== hostOf(url)) await chrome.storage.session.remove(trailKey(tabId));
  // The content script may have asked before the load was stored.
  chrome.tabs.get(tabId).then(pushTitle, () => {});
});

// SPA (history.pushState): the page does not reload, so the content script will not ask by itself.
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId === 0) chrome.tabs.get(tabId).then(pushTitle, () => {});
});

// A link opened in a new tab (Ctrl+click, target=_blank) keeps the trail of the tab it came from.
chrome.webNavigation.onCreatedNavigationTarget.addListener(async ({ sourceTabId, tabId }) => {
  const trail = await sessionGet(trailKey(sourceTabId));
  if (!trail) return;
  await chrome.storage.session.set({ [trailKey(tabId)]: trail });
  chrome.tabs.get(tabId).then(pushTitle, () => {});
});

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.storage.session.remove([pendingKey(tabId), loadKey(tabId), trailKey(tabId)]),
);

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onImportBegan.addListener(() => {
  importing = true;
  clearTimeout(refreshTimer);
});
chrome.bookmarks.onImportEnded.addListener(() => {
  importing = false;
  onBookmarksChanged();
});
onScopesChanged(onSettingsChanged);
onPageTitleChanged(onSettingsChanged);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'get-title' && sender.tab && sender.frameId === 0) {
    titleMessage(sender.tab).then(sendResponse);
    return true;
  }
  // From the popup: only the extension's own pages may ask for a tab's state.
  if (msg?.type === 'tab-state' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    chrome.tabs.get(msg.tabId).then(tabState, () => ({ supported: false })).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await migrateSettings();
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
chrome.runtime.onStartup.addListener(async () => {
  await migrateSettings();
  updateMenu();
});
