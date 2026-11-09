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

// Host without "www.", the unit for "keep the bookmark name on the whole host".
export function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
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
