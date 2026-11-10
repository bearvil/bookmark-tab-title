// Matches tab URLs against bookmarks. No chrome.* APIs, so it can be tested in Node.

// Loose key: no protocol, "www.", #fragment or trailing slash.
// That way the bookmark "http://example.com/" also matches "https://www.example.com#x".
export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const port = url.port ? `:${url.port}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${host}${port}${path}${url.search}`;
}

// Second-level labels under a two-letter country code, e.g. "example.co.uk" is one site.
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

// Approximate registrable domain ("accounts.example.com" → "example.com"); IPs and single-label hosts as they are.
export function siteOf(raw) {
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)) return host;
  const labels = host.split('.');
  const tld = labels.at(-1);
  const keep = labels.length > 2 && tld.length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function originOf(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

// Host without "www.", with the port when it is not the default one (localhost:3000 and localhost:8040 are different
// apps): the unit of the "below", "contains" and "whole host" scopes and of the tab's trail.
export function hostOf(raw) {
  try {
    return new URL(raw).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Index built from chrome.bookmarks.getTree(). For duplicates the first one in the tree wins (the bookmarks bar comes first).
export function buildIndex(tree) {
  const exact = new Map();
  const loose = new Map();
  const walk = (nodes) => {
    for (const node of nodes) {
      const title = node.title?.trim();
      if (node.url && title) {
        const bookmark = { id: node.id, title, url: node.url };
        if (!exact.has(node.url)) exact.set(node.url, bookmark);
        const key = normalizeUrl(node.url);
        if (key && !loose.has(key)) loose.set(key, bookmark);
      }
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return { exact, loose };
}

// The first URL wins (the tab's current URL), then the others (e.g. the URL before a redirect).
export function findBookmark(index, ...urls) {
  for (const url of urls) {
    if (!url) continue;
    if (index.exact.has(url)) return index.exact.get(url);
    const key = normalizeUrl(url);
    if (key && index.loose.has(key)) return index.loose.get(key);
  }
  return null;
}

// --- How far a bookmark name reaches beyond the bookmarked address.
// exact:    only the bookmarked address (the default).
// below:    the address and the pages under it, in a tab that came through the bookmark.
// contains: every page of the bookmark's host whose address contains one of the given texts, in any tab.
// host:     every page of the bookmark's host, in a tab that came through the bookmark.
export const SCOPES = ['exact', 'below', 'contains', 'host'];

const pathOf = (url) => url.pathname.replace(/\/+$/, '');

// Is the page under the bookmarked address ("/docs" covers "/docs" and "/docs/a", not "/docsx")?
export function covers(bookmarkUrl, pageUrl) {
  let b, p;
  try {
    b = new URL(bookmarkUrl);
    p = new URL(pageUrl);
  } catch {
    return false;
  }
  if (hostOf(bookmarkUrl) !== hostOf(pageUrl)) return false;
  const base = pathOf(b);
  const path = pathOf(p);
  return path === base || path.startsWith(`${base}/`);
}

// Length of the longest space-separated text found in the address after the host (path, query and #fragment),
// ignoring case; 0 when none is.
export function containsMatch(text, pageUrl) {
  let p;
  try {
    p = new URL(pageUrl);
  } catch {
    return 0;
  }
  const tail = `${p.pathname}${p.search}${p.hash}`.toLowerCase();
  let decoded = tail;
  try {
    decoded = decodeURIComponent(tail);
  } catch {}
  const pieces = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return Math.max(0, ...pieces.filter((piece) => tail.includes(piece) || decoded.includes(piece)).map((piece) => piece.length));
}

// A starting text for "address contains", from the bookmark's address: a resource id when there is one (stable),
// else the Google account marker, else the path.
export function suggestText(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  const address = `${url.pathname}${url.search}${url.hash}`;
  const patterns = [
    /\/developers\/\d+/, // Google Play Console
    /[?&#]project=[^&#]+/, // Google Cloud Console
    /\/project\/[^/?#]+/, // Firebase
    /\/a\/[^/?#]+\/g\/[^/?#]+/, // Google Groups of a Workspace domain
    /[?&#]authuser=[^&#]+/, // Google account, as a number or an email
    /\/u\/\d+\//, // Google account number
  ];
  for (const pattern of patterns) {
    const found = address.match(pattern)?.[0];
    if (found) return found.replace(/^[?&#]/, '');
  }
  return pathOf(url);
}

// Which bookmark names the page; the most specific one wins:
// 1. a bookmark of this very address (also the address before a same-site redirect, see background.js);
// 2. a "contains" bookmark of this host whose text is in the address (longest text first);
// 3. a "below" bookmark the tab came through, with the page under its address (deepest first);
// 4. the "whole host" bookmark the tab came through last.
// scopes: Map of normalized bookmark URL → { scope, text }. trail: bookmark URLs the tab visited on this host,
// oldest first.
export function resolve(index, scopes, { url, loaded = [], trail = [] }) {
  const direct = findBookmark(index, url, ...loaded);
  const settingOf = (bookmark) => scopes.get(normalizeUrl(bookmark.url)) ?? { scope: 'exact' };
  if (direct) return { bookmark: direct, via: 'address', ...settingOf(direct) };

  const host = hostOf(url);
  let best = null;
  const offer = (bookmark, via, rank, weight) => {
    if (!best || rank > best.rank || (rank === best.rank && weight >= best.weight)) best = { bookmark, via, rank, weight };
  };
  for (const [key, setting] of scopes) {
    if (setting.scope !== 'contains') continue;
    const bookmark = index.loose.get(key);
    const length = bookmark && hostOf(bookmark.url) === host ? containsMatch(setting.text, url) : 0;
    if (length) offer(bookmark, 'contains', 3, length);
  }
  trail.forEach((visited, i) => {
    // The trail belongs to this host; a bookmark recorded after a same-site redirect may have another subdomain.
    const bookmark = findBookmark(index, visited);
    if (!bookmark) return;
    const { scope } = settingOf(bookmark);
    if (scope === 'below' && covers(bookmark.url, url)) offer(bookmark, 'below', 2, pathOf(new URL(bookmark.url)).length);
    if (scope === 'host') offer(bookmark, 'host', 1, i);
  });
  return best ? { bookmark: best.bookmark, via: best.via, ...settingOf(best.bookmark) } : { bookmark: null };
}

// The tab's trail after a visit to a bookmarked address: the visit goes last; another host starts a new trail.
export const TRAIL_LIMIT = 20;
export function recordVisit(trail, host, bookmarkUrl) {
  const urls = trail?.host === host ? trail.urls.filter((u) => u !== bookmarkUrl) : [];
  return { host, urls: [...urls, bookmarkUrl].slice(-TRAIL_LIMIT) };
}

// The tab's trail after resolve() named its page: the address of a "below" or "whole host" bookmark is recorded
// (other bookmarks never name other pages, and must not push those out of the trail), any page of another host
// ends the trail.
export function nextTrail(trail, host, found) {
  if (found.via === 'address' && ['below', 'host'].includes(found.scope)) return recordVisit(trail, host, found.bookmark.url);
  return trail?.host === host ? trail : null;
}
