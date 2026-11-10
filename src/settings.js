// How far each bookmark name reaches (see SCOPES in match.js) — one setting per bookmark, shared by the popup,
// the options page and the context menu. Stored in storage.sync under the bookmark's normalized URL (bookmark ids
// differ per device) as { scope, text }; "exact" is the default and is not stored.
import { normalizeUrl, SCOPES } from './match.js';

export const SCOPE_PREFIX = 'scope:';
// Before 1.0.0 there was only an on/off switch for the whole host.
const OLD_PREFIX = 'keepOnHost:';

const keyFor = (url) => {
  const key = normalizeUrl(url);
  return key && SCOPE_PREFIX + key;
};

export const cleanScope = (value) => {
  const scope = SCOPES.includes(value?.scope) ? value.scope : 'exact';
  return scope === 'contains' ? { scope, text: String(value.text ?? '').trim() } : { scope };
};

export async function getScope(url) {
  const key = keyFor(url);
  return cleanScope(key ? (await chrome.storage.sync.get(key))[key] : null);
}

export async function setScope(url, scope, text = '') {
  const key = keyFor(url);
  if (!key) return;
  const value = cleanScope({ scope, text });
  if (value.scope === 'exact') await chrome.storage.sync.remove(key);
  else await chrome.storage.sync.set({ [key]: value });
}

// Map of normalized bookmark URL → { scope, text } for every bookmark with a wider scope than "exact".
export async function getAllScopes() {
  const all = await chrome.storage.sync.get(null);
  return new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith(SCOPE_PREFIX))
      .map(([k, v]) => [k.slice(SCOPE_PREFIX.length), cleanScope(v)]),
  );
}

export function onScopesChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(SCOPE_PREFIX))) callback();
  });
}

// Add the page's own title after the bookmark name: one option for every bookmark (off by default, not stored),
// and per bookmark under its normalized URL, stored only where it differs from that option.
export const APPEND_KEY = 'appendPageTitle';
export const TITLE_PREFIX = 'title:';

export async function getAppendPageTitle() {
  return (await chrome.storage.sync.get(APPEND_KEY))[APPEND_KEY] === true;
}

export async function setAppendPageTitle(on) {
  if (on) await chrome.storage.sync.set({ [APPEND_KEY]: true });
  else await chrome.storage.sync.remove(APPEND_KEY);
}

// Map of normalized bookmark URL → true/false for the bookmarks with their own choice.
export async function getTitleOverrides() {
  const all = await chrome.storage.sync.get(null);
  return new Map(
    Object.entries(all)
      .filter(([k, v]) => k.startsWith(TITLE_PREFIX) && typeof v === 'boolean')
      .map(([k, v]) => [k.slice(TITLE_PREFIX.length), v]),
  );
}

// Whether the page title is added for this bookmark: its own choice, or the option for every bookmark.
export async function getPageTitleFor(url) {
  const key = normalizeUrl(url);
  const [overrides, all] = await Promise.all([getTitleOverrides(), getAppendPageTitle()]);
  return overrides.get(key) ?? all;
}

// A choice equal to the option for every bookmark is not stored, so the bookmark follows that option again.
export async function setPageTitleFor(url, on) {
  const key = normalizeUrl(url);
  if (!key) return;
  if (on === (await getAppendPageTitle())) await chrome.storage.sync.remove(TITLE_PREFIX + key);
  else await chrome.storage.sync.set({ [TITLE_PREFIX + key]: on });
}

// The option for every bookmark or a bookmark's own choice changed.
export function onPageTitleChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k === APPEND_KEY || k.startsWith(TITLE_PREFIX))) callback();
  });
}

// Bookmark names in tabs, on or off: for every bookmark (on by default) and per bookmark. Stored only while off:
// DISABLED_KEY for every bookmark, OFF_PREFIX + normalized URL for one bookmark.
export const DISABLED_KEY = 'disabled';
export const OFF_PREFIX = 'off:';

// { all: on for every bookmark, off: Set of normalized URLs of the bookmarks turned off }
export async function getOnOff() {
  const all = await chrome.storage.sync.get(null);
  const off = new Set(Object.keys(all).filter((k) => k.startsWith(OFF_PREFIX) && all[k] === true).map((k) => k.slice(OFF_PREFIX.length)));
  return { all: all[DISABLED_KEY] !== true, off };
}

export async function setOnForAll(on) {
  if (on) await chrome.storage.sync.remove(DISABLED_KEY);
  else await chrome.storage.sync.set({ [DISABLED_KEY]: true });
}

export async function setBookmarkOn(url, on) {
  const key = normalizeUrl(url);
  if (!key) return;
  if (on) await chrome.storage.sync.remove(OFF_PREFIX + key);
  else await chrome.storage.sync.set({ [OFF_PREFIX + key]: true });
}

export function onOnOffChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k === DISABLED_KEY || k.startsWith(OFF_PREFIX))) callback();
  });
}

// "Keep on whole host" switched on → the "whole host" scope, unless the bookmark already has a newer setting.
// Runs on install, update and browser start (an older version on another device may still sync old keys).
export async function migrateSettings() {
  const all = await chrome.storage.sync.get(null);
  const old = Object.keys(all).filter((k) => k.startsWith(OLD_PREFIX));
  if (!old.length) return;
  const moved = Object.fromEntries(
    old
      .map((k) => [k, SCOPE_PREFIX + k.slice(OLD_PREFIX.length)])
      .filter(([k, key]) => all[k] === true && !(key in all))
      .map(([, key]) => [key, { scope: 'host' }]),
  );
  await chrome.storage.sync.set(moved);
  await chrome.storage.sync.remove(old);
}
