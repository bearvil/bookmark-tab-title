# Bookmark-Tab Title

A browser extension for Chrome and other Chromium-based browsers (Edge, Opera, Brave, Vivaldi): when the page in a tab is one of your bookmarks, the tab shows **the name of the bookmark** instead of the page title.

Rename a bookmark to "Mail – work" and the tab is called exactly that, even when the page keeps changing its own title (like Gmail with its unread count).

## How it works
- Matches the tab URL against your bookmarks: exact match first, then ignoring the protocol, `www.`, the `#fragment` and a trailing `/`.
- Also works after a redirect within the same site (bookmark `example.com` → `example.com/login`) and through in-page navigation in single-page apps. A page on another site never gets your bookmark name.
- Updates immediately when you add, rename or delete a bookmark. Deleting it restores the page's own title.
- **How far the name reaches**, per bookmark:
  - **Only this address** (default).
  - **This address and the pages under it**: once the tab has been on the bookmarked address, e.g. `example.com/docs` also names `example.com/docs/a/b`.
  - **Pages whose address contains** a text: every page of the bookmark's host whose path, query or `#fragment` contains it, in any tab, also for links opened from mail. Made for several accounts: `/u/1/` or `authuser=1` at Google, a Play Console `/developers/<id>`, a Cloud `project=<id>`. Separate alternatives with a space.
  - **The whole site**: once the tab has been on the bookmarked address, every page of that host.
- The most specific bookmark wins: the bookmark of the page itself, then "address contains", then "pages under it" (the deepest), then the last "whole site" bookmark the tab came through. A page with a bookmark of its own shows that name, and the next page returns to the "whole site" name. Leaving the host ends the trail; a link opened in a new tab keeps it.
- One setting, three places: the toolbar popup (the bookmark of the current page, its name and its scope), the settings page with all bookmarks, and the page's right-click menu.
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
npm run try         # visible Chromium with the extension and sample bookmarks, throwaway profile
npm run package     # store zip → dist/bookmark-tab-title-<version>.zip
```

## Limitations
- Does not work on browser pages (`chrome://…`), in the Chrome Web Store or in the built-in PDF viewer, where browsers do not allow extensions to change content.
- After in-page (SPA) navigation inside a page opened from a bookmark, the bookmark name stays until the page loads a different URL.

## Privacy
No data is collected and nothing leaves your browser. See the [privacy policy](https://bearvil.github.io/privacy-policies/bookmark-tab-title-pp).

## License
[MIT](LICENSE) © Bearvil
