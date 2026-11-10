// How far each bookmark name reaches (see SCOPES in match.js) — one setting per bookmark, shared by the popup,
// the options page and the context menu. Stored in storage.sync under the bookmark's normalized URL (bookmark ids
// differ per device) as { scope, text }; "exact" is the default and is not stored.
import { normalizeUrl, SCOPES } from './match.js';

const PREFIX = 'scope:';
// Before 1.0.0 there was only an on/off switch for the whole host.
const OLD_PREFIX = 'keepOnHost:';

const keyFor = (url) => {
  const key = normalizeUrl(url);
  return key && PREFIX + key;
};

const clean = (value) => {
  const scope = SCOPES.includes(value?.scope) ? value.scope : 'exact';
  return scope === 'contains' ? { scope, text: String(value.text ?? '').trim() } : { scope };
};

export async function getScope(url) {
  const key = keyFor(url);
  return clean(key ? (await chrome.storage.sync.get(key))[key] : null);
}

export async function setScope(url, scope, text = '') {
  const key = keyFor(url);
  if (!key) return;
  const value = clean({ scope, text });
  if (value.scope === 'exact') await chrome.storage.sync.remove(key);
  else await chrome.storage.sync.set({ [key]: value });
}

// Map of normalized bookmark URL → { scope, text } for every bookmark with a wider scope than "exact".
export async function getAllScopes() {
  const all = await chrome.storage.sync.get(null);
  return new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), clean(v)]),
  );
}

export function onScopesChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) callback();
  });
}

// One option for every bookmark: add the page's own title after the bookmark name. Off by default (not stored).
const APPEND_KEY = 'appendPageTitle';

export async function getAppendPageTitle() {
  return (await chrome.storage.sync.get(APPEND_KEY))[APPEND_KEY] === true;
}

export async function setAppendPageTitle(on) {
  if (on) await chrome.storage.sync.set({ [APPEND_KEY]: true });
  else await chrome.storage.sync.remove(APPEND_KEY);
}

export function onAppendPageTitleChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && APPEND_KEY in changes) callback();
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
      .map((k) => [k, PREFIX + k.slice(OLD_PREFIX.length)])
      .filter(([k, key]) => all[k] === true && !(key in all))
      .map(([, key]) => [key, { scope: 'host' }]),
  );
  await chrome.storage.sync.set(moved);
  await chrome.storage.sync.remove(old);
}
