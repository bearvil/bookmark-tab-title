# Bookmark-Tab Title

A browser extension for Chrome and other Chromium-based browsers (Edge, Opera, Brave, Vivaldi): when the page in a tab is one of your bookmarks, the tab shows **the name of the bookmark** instead of the page title.

Rename a bookmark to "Mail – work" and the tab is called exactly that, even when the page keeps changing its own title (like Gmail with its unread count).

## How it works
- Matches the tab URL against your bookmarks: exact match first, then ignoring the protocol, `www.`, the `#fragment` and a trailing `/`.
- Remembers the URL a navigation started from, so it also works when the page redirects (bookmark `example.com` → `example.com/login`).
- Updates immediately when you add, rename or delete a bookmark. Deleting it restores the page's own title.
- Everything happens locally. No network requests, no analytics, no account.

## Install (development)
1. Open `chrome://extensions` (Edge: `edge://extensions`, Opera: `opera://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Development
```bash
npm install
npm test            # unit tests for URL matching
npm run test:e2e    # real Chromium with the extension and real bookmarks (HEADED=1 to watch)
```

## Limitations
- Does not work on browser pages (`chrome://…`), in the Chrome Web Store or in the built-in PDF viewer, where browsers do not allow extensions to change content.
- After in-page (SPA) navigation inside a page opened from a bookmark, the bookmark name stays until the page loads a different URL.
