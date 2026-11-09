# Store listing

Text for the Chrome Web Store, Microsoft Edge Add-ons and Opera Add-ons. Keep it in sync with `_locales/` and the privacy policy.

## Basics

| Field | Value |
|---|---|
| Name | Bookmark-Tab Title |
| Short description (≤ 132 chars) | Shows the name of your bookmark as the tab title whenever a bookmarked page is open. |
| Category | Chrome Web Store: Productivity → Tools · Edge: Productivity · Opera: Productivity |
| Language | English (default), Croatian (`_locales/hr`) |
| Website | https://github.com/bearvil/bookmark-tab-title |
| Support / contact | bearvil.info@gmail.com |
| Privacy policy | https://bearvil.github.io/privacy-policies/bookmark-tab-title-pp |
| Price | Free |

## Detailed description

Too many tabs called "Inbox", "Dashboard" or "Login"? Give them the names you already chose.

Bookmark-Tab Title shows the name of your bookmark as the tab title whenever the page in a tab is one of your bookmarks. Rename a bookmark to "Mail – work" and the tab is called "Mail – work", even when the site keeps changing its own title, like an unread counter.

How it works
• Open any bookmarked page and the tab takes the bookmark's name.
• Rename, add or delete a bookmark and open tabs update right away. Delete it and the page's own title comes back.
• Works when a site redirects within itself, e.g. a bookmark for example.com that lands on example.com/login. A page on another site never gets your bookmark name.
• Small differences in the address are ignored: http/https, "www.", a trailing slash or a #section.

Keep the name on the whole host
• Turn it on per bookmark and the tab keeps the bookmark's name on every page of that host, e.g. all of mail.example.com, not only the bookmarked address. Leaving the host ends it.
• One switch, three places: the extension's popup (with the bookmark name of the page you are on, editable), the settings page with all your bookmarks, and the right-click menu.

Private by design
• No data collected, no account, no analytics, no ads.
• No network requests at all. Your bookmarks never leave your browser.
• Open source under the MIT license.

Works in Chrome, Edge, Opera, Brave, Vivaldi and other Chromium-based browsers.

## Single purpose

Shows the name of the user's bookmark as the browser tab title whenever the page open in that tab is one of the user's bookmarks.

## Permission justifications

| Permission | Justification |
|---|---|
| `bookmarks` | Reads the user's bookmark names and URLs locally to find the bookmark that matches the page open in a tab and show its name as the tab title. A bookmark is only renamed or added when the user does so in the extension's popup. Bookmarks are never sent anywhere. |
| `contextMenus` | Adds one checkbox item to the page's right-click menu: "Keep bookmark name on all of <host>", the same per-bookmark setting as in the popup and the settings page. |
| Host permissions `http://*/*`, `https://*/*` | Any website can be a bookmark, so the bundled content script must be able to run on any http/https page to set its document title to the bookmark name, and the service worker needs the tab URL to match it against bookmarks. The extension makes no network requests and does not read page content. |
| `webNavigation` | Detects the URL a page load started from before a same-site server redirect (e.g. a bookmark for example.com that redirects to example.com/login), so the bookmark name is still applied, and detects in-page (history API) navigation so the title stays correct in single-page apps. |
| `scripting` | Used only when the extension is installed or updated, to inject its own bundled content script into tabs that were already open, so it works without reloading every tab. No remote or dynamically generated code is executed. |
| `storage` | `chrome.storage.sync` keeps the user's per-bookmark "keep the name on the whole host" setting (the bookmark URLs that have it on). `chrome.storage.session` (held in memory, cleared when the tab or browser closes) remembers, per tab, the URLs its current page was loaded from and the bookmark it was opened from, while the service worker is idle. |
| Remote code | None. All code is in the package; no remote scripts, no `eval`. |

## Privacy practices (Chrome Web Store)

- Data collected: **none**. The Chrome Web Store counts data as collected when it is transmitted off the device; this extension reads bookmarks and the URLs of open tabs only locally, for its single purpose, and transmits nothing. (If a reviewer asks for a declaration anyway, the closest category is "Web history".)
- Certifications: does not sell or transfer user data to third parties; does not use or transfer data for purposes unrelated to the single purpose; does not use or transfer data to determine creditworthiness or for lending.

## Images

| Asset | File | Size |
|---|---|---|
| Store icon | `icons/icon-128.png` | 128×128 |
| Screenshot | `store/screenshot-1280x800.png` | 1280×800 |
| Small promo tile | `store/promo-small-440x280.png` | 440×280 |

## Package

```bash
npm run package   # → dist/bookmark-tab-title-<version>.zip
```

Upload the same zip to all three stores.
