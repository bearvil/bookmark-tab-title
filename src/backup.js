// Settings file: export and import of the scopes and page title choices. Settings belong to a bookmark's
// normalized address, so an imported setting applies to every bookmark with the same address, in any folder,
// under any name, also one added later. No chrome APIs here: the settings page reads and writes the storage.
import { normalizeUrl, SCOPES } from './match.js';
import { APPEND_KEY, cleanScope, SCOPE_PREFIX, TITLE_PREFIX } from './settings.js';

export const APP = 'bookmark-tab-title';
export const FORMAT = 1;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// The file for the stored settings (all of storage.sync) and the web bookmarks. Every bookmark is in it, also with
// the default "only this address", so an import also brings those back; settings of addresses without a bookmark
// are kept too.
export function buildExport(stored, bookmarks, now = new Date()) {
  const names = new Map();
  for (const b of bookmarks) {
    const key = normalizeUrl(b.url);
    if (key && !names.has(key)) names.set(key, b.title);
  }
  const entries = new Map();
  const entry = (key) => entries.get(key) ?? entries.set(key, { address: key, scope: 'exact' }).get(key);
  for (const key of names.keys()) entry(key);
  for (const [k, v] of Object.entries(stored)) {
    if (k.startsWith(SCOPE_PREFIX)) Object.assign(entry(k.slice(SCOPE_PREFIX.length)), cleanScope(v));
    if (k.startsWith(TITLE_PREFIX) && typeof v === 'boolean') entry(k.slice(TITLE_PREFIX.length)).pageTitle = v;
  }
  // An unknown stored value of an address without a bookmark reads as the default, which needs no entry.
  const list = [...entries.values()]
    .filter((e) => names.has(e.address) || e.scope !== 'exact' || e.pageTitle !== undefined)
    .map((e) => (names.has(e.address) ? { address: e.address, name: names.get(e.address), ...e } : e))
    .sort((a, b) => a.address.localeCompare(b.address));
  return { app: APP, format: FORMAT, exported: now.toISOString(), pageTitleForAll: stored[APPEND_KEY] === true, bookmarks: list };
}

export const exportFileName = (now = new Date()) => `${APP}-settings-${now.toISOString().slice(0, 10)}.json`;

// An address from the file: a normalized address as exported, or a full URL.
const keyOf = (address) => (typeof address === 'string' ? normalizeUrl(address.includes('://') ? address : `https://${address}`) : null);

// Reads a settings file. Returns { error } ('file' | 'size') or { pageTitleForAll, entries, skipped }, where each
// entry is { key, scope, text?, pageTitle? } and skipped counts the entries that were left out.
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) return { error: 'size' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'file' };
  }
  if (data?.app !== APP || data.format !== FORMAT || !Array.isArray(data.bookmarks)) return { error: 'file' };
  const entries = new Map();
  let skipped = 0;
  for (const item of data.bookmarks) {
    const key = keyOf(item?.address);
    if (!key || (item.scope !== undefined && !SCOPES.includes(item.scope))) {
      skipped++;
      continue;
    }
    const entry = { key, ...cleanScope(item) };
    if (typeof item.pageTitle === 'boolean') entry.pageTitle = item.pageTitle;
    entries.set(key, entry); // the last one of the same address wins
  }
  const pageTitleForAll = typeof data.pageTitleForAll === 'boolean' ? data.pageTitleForAll : undefined;
  return { pageTitleForAll, entries: [...entries.values()], skipped };
}

// What an import writes: each address in the file gets exactly the file's setting (the default where the file
// has none); other addresses keep theirs. A page title choice equal to the option for every bookmark is not stored.
export function planImport(parsed, currentPageTitleForAll) {
  const all = parsed.pageTitleForAll ?? currentPageTitleForAll;
  const set = {};
  const remove = [];
  if (parsed.pageTitleForAll === true) set[APPEND_KEY] = true;
  if (parsed.pageTitleForAll === false) remove.push(APPEND_KEY);
  for (const e of parsed.entries) {
    if (e.scope === 'exact') remove.push(SCOPE_PREFIX + e.key);
    else set[SCOPE_PREFIX + e.key] = e.scope === 'contains' ? { scope: e.scope, text: e.text } : { scope: e.scope };
    if (e.pageTitle === undefined || e.pageTitle === all) remove.push(TITLE_PREFIX + e.key);
    else set[TITLE_PREFIX + e.key] = e.pageTitle;
  }
  return { set, remove };
}

// How many entries are for bookmarks there are now, and how many for addresses without a bookmark yet.
export function summarize(parsed, bookmarks) {
  const have = new Set(bookmarks.map((b) => normalizeUrl(b.url)).filter(Boolean));
  const matching = parsed.entries.filter((e) => have.has(e.key)).length;
  return { total: parsed.entries.length, matching, other: parsed.entries.length - matching, skipped: parsed.skipped };
}
