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

// Index built from chrome.bookmarks.getTree(). For duplicates the first one in the tree wins (the bookmarks bar comes first).
export function buildIndex(tree) {
  const exact = new Map();
  const loose = new Map();
  const walk = (nodes) => {
    for (const node of nodes) {
      const title = node.title?.trim();
      if (node.url && title) {
        if (!exact.has(node.url)) exact.set(node.url, title);
        const key = normalizeUrl(node.url);
        if (key && !loose.has(key)) loose.set(key, title);
      }
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return { exact, loose };
}

// The first URL wins (the tab's current URL), then the others (e.g. the URL before a redirect).
export function findTitle(index, ...urls) {
  for (const url of urls) {
    if (!url) continue;
    if (index.exact.has(url)) return index.exact.get(url);
    const key = normalizeUrl(url);
    if (key && index.loose.has(key)) return index.loose.get(key);
  }
  return null;
}
