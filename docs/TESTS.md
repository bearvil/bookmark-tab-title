# Tests

Every test of the extension, by area. Run them with:

```bash
npm test            # unit tests (Node, no browser)
npm run test:e2e    # end-to-end: real Chromium with the extension and real bookmarks (HEADED=1 to watch)
```

CI runs both on every push (`.github/workflows/`).

59 unit tests and 55 end-to-end tests.

## Unit tests

### URL matching and scopes (`src/match.js`)

- normalizeUrl ignores protocol, www, fragment and trailing slash
- normalizeUrl rejects non-web URLs
- loose match: https + www matches an http bookmark
- fragment is ignored (Gmail changes the \#)
- exact match wins over loose match
- for duplicates the first one in the tree wins
- blank bookmark names are skipped
- URL before a redirect as the second candidate
- siteOf groups subdomains of one site
- siteOf keeps IPs and single-label hosts as they are
- different sites differ, e.g. a link shortener and its target
- originOf
- findBookmark returns id, name and URL
- hostOf drops www. and keeps subdomains apart
- hostOf keeps a port that is not the default one
- covers: the address and the pages under it, same host only
- containsMatch: anywhere after the host, any of the texts, ignoring case
- suggestText: a stable resource id first, then the Google account, then the path
- exact (default): the name only on the bookmarked address
- P1: own bookmark on its address, then back to the last whole-host bookmark
- P1: a whole-host bookmark takes over until another whole-host bookmark address is visited
- P2: typing the address counts, a deep link without the bookmark address does not
- whole host after a same-site redirect to another subdomain names the landing host
- only below and whole-host bookmarks enter the trail, so many other bookmarks cannot push them out
- another port is another host: no whole-host, below or contains name there
- leaving the host ends the trail
- below: the pages under the address, the deepest one first, then whole host
- contains: works without a trail, per Google account
- contains wins over whole host, an own bookmark wins over contains
- contains only on the bookmark host
- resolve reports the scope of the shown bookmark
- recordVisit keeps the last visits of one host, most recent last
- a bookmark turned off names no page, and another bookmark of the host may name it instead

### Stored settings (`src/settings.js`)

- exact is the default and is not stored
- one setting per normalized address, text only for contains
- unknown stored values fall back to exact
- the old "keep on whole host" switch becomes the whole-host scope
- migration never overwrites a newer setting
- the page title option is off by default, stored only while on, and not a scope
- a bookmark's own page title choice overrides the option for every bookmark, stored only when different
- on for every bookmark and per bookmark by default, stored only while off

### Settings file (`src/backup.js`)

- export: every bookmark (also with the default) and every stored setting, one entry per address
- import reads back what export wrote
- import: full URLs are matched like bookmarks, invalid entries are skipped, the last of an address wins
- import refuses other files and files that are too large
- plan: the file decides for its addresses, defaults are removed, a choice equal to the option is not stored
- summary: entries for bookmarks there are now, and for addresses without one
- a bookmark exported with the default gets the default back on import
- turned off, for every bookmark and per bookmark, goes into the file and back

### Texts in English and Croatian (`_locales/`)

- every locale has the same messages, with the same placeholders, none empty
- every message the code uses exists
- no message is left over
- the toolbar badge fits (4 characters at most)

### Manifest and package

- manifest and package.json versions match
- every locale defines every message the manifest uses
- store description fits the 132 character limit
- the package script ships exactly the packaged folders
- every file the manifest references exists and is packaged
- every local file the extension pages and styles reference exists and is packaged

## End-to-end tests (55)

### Tab title

- opened bookmark → tab title is the bookmark name
- page that is not a bookmark keeps its own title
- renamed bookmark → title changes immediately
- deleted bookmark → page title is restored
- bookmark added while the page is open → title changes
- page that changes its own title (Gmail) → bookmark name stays
- bookmark with a redirect (/redir → /landing) → bookmark name
- loose match: bookmark /slash/, opened /slash#section
- SPA navigation (pushState) inside a bookmark → name stays
- aborted navigation to a bookmark does not leak its name to the page
- redirect to another site does not carry the bookmark name
- second copy of the content script (extension update) restores the right title
- many bookmark changes at once are refreshed once, and the names are right

### Scopes, popup and trail

- only this address (default): another page of the host shows its own title
- popup shows the bookmark of the page and its scope
- popup: whole host → the name stays on other pages and after a reload
- a bookmark of its own shows its name, then the tab returns to the whole-host name
- popup on a page named by the trail shows that bookmark and why
- a link opened in a new tab keeps the trail
- a deep link in a fresh tab does not get the whole-host name
- leaving the host ends the whole-host name
- options page: pages under the address win over the whole host
- popup: address contains (Google account) → the name in any tab, suggested text
- another port is another app: no whole-host or contains name there
- popup: typing another text changes where the name shows
- popup keeps editing its own bookmark when the change moves the name to another one
- options page shows the same choice and changing it works everywhere
- popup renames the bookmark and the tab follows
- popup on a page that is not a bookmark can bookmark it

### Settings page

- settings page: folders view by default, every folder closed, with counts
- settings page: "How it works" is closed by default and opens on click
- settings page: open folders are remembered
- settings page: search shows only folders with matches, open, and keeps the remembered ones
- settings page: filter by scope, with counts
- settings page: order within a folder, folders first
- settings page: one list, as before, with the folder of each bookmark
- settings page: ?edit= opens the folders above the bookmark

### Settings file

- settings file: export, then import applies the settings to every bookmark with the same address
- settings file: a bookmark exported with "only this address" gets it back on import
- settings file: turned off, for all bookmarks and for one, goes into the file and comes back
- settings file: another file is refused and nothing changes

### Page title

- page title option is off by default
- page title option on → "bookmark name — page title", following the page
- page title option: a page that edits its current title does not repeat the name
- page title option off again → only the bookmark name
- page title per bookmark (popup) overrides the option for every bookmark
- page title per bookmark (settings row) shows the choice and changes it
- page title with markup in it: only its text is added
- page title that has the bookmark name in it shows the name once

### On and off

- turned off for all bookmarks: tabs show the page titles, the button says OFF, the popup still works
- turned off for one bookmark (popup): the page title, and the popup keeps that bookmark to turn it on
- turned off for one bookmark (settings row): shown under "Turned off", and its scope reaches no page

### Other

- context menu has one item per scope (clicking native menus is not scriptable)
- another tab without a bookmark is not affected
- after an extension update the old copy of the script does not take the page title away
