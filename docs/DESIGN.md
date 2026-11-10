# Design

The popup and the settings page share one small design system. Pages only compose the components below; colors, sizes and fonts live in `src/ui/tokens.css` and nowhere else.

## Direction
- **For:** people with many tabs who name their bookmarks.
- **Mood:** calm, precise, quiet.
- **Palette:** "Astra" — teal-black gradient with a mint accent (`#5EEAD4` dark, `#00666B` light) and the orange ribbon of the icon (`#FB8742`) used only in the icon. Dark and light follow the system theme.
- **Font:** Nunito (variable, latin + latin-ext), bundled in `fonts/` so the extension makes no network requests.
- **Surfaces:** translucent "glass" levels with hairline borders on top of one diagonal gradient; elevation is lightening, not shadow.

## Tokens (`src/ui/tokens.css`)
| Group | Tokens |
|---|---|
| Atmosphere | `--base`, `--gradient`, `--accent`, `--accent-text`, `--accent-soft` |
| Text roles | `--text-primary`, `--text-secondary` (informational text), `--text-tertiary` (placeholders and icons only), `--text-danger` |
| Elevation | `--surface-1…3`, `--border-1…2`, `--divider`, `--switch-off`, `--switch-thumb`, `--shadow-soft` |
| Shape | `--radius-xs 4`, `--radius-sm 8`, `--radius-md 16`, `--radius-lg 22`, `--radius-round` |
| Spacing | `--space-xxs 2`, `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `xxl 32` |
| Type | `--font`, `--text-micro 12`, `--text-caption 13`, `--text-body 15`, `--text-title 17`, `--text-large-title 19`, `--text-display 26` |

## Components (`src/ui/components.css`)
| Component | Variants | Used for |
|---|---|---|
| `.text-*` + `.tone-*` | display, title, body, caption, micro · secondary, accent | All text |
| `.truncate`, `.split` | — | One-line text with an ellipsis; in a `.split` line only the `.truncate` part (an address) shortens |
| `.brand` | — | Icon + name header |
| `.surface` | `--2` (nested), `--pad` | Glass cards |
| `.group` | `__label` | A caption above a surface |
| `.row` | `--stack`, `--wrap` (+ `.row__full`) | Rows inside a surface, split by hairline dividers |
| `.field`, `.field-label`, `.search` | `.field--compact` | Text inputs, search with icon |
| `.switch` | — | `<input type="checkbox" role="switch">` |
| `.switch--small`, `.inline-switch` | — | Small switch with a short label beside it, inline in a row or a label line ("Page title") |
| `.field-wrap`, `.field-wrap__note` | — | A field with a status note ("Saved") inside it on the right |
| `.segmented` | — | Two or three radio options in one pill, the chosen one filled with the accent (Folders / List) |
| `.folder`, `.folder__head`, `.folder__list` | — | Collapsible folder (`<details>`): a `.row` summary with a chevron, name, pill and count; nested folders indent |
| `.radio`, `.choices`, `.choice` | — | A surface of `.row` labels with a radio each; the selected row is tinted; `.choices--dense` for less height (the popup, which Chrome cuts at 600 px) |
| `.select` | — | `<span class="select"><select>` pill with a chevron |
| `.button` | `--primary`, `--ghost`, `--block` | Pill buttons; one primary action per view |
| `.icon-button`, `.icon` | — | Round glass icon button (≥ 40 px), 20 px stroke icons |
| `.pill` | — | Accent label, e.g. the host name |
| `.toast` | `data-visible` | Short "Saved" note |
| `.empty` | — | Empty states with a title and a hint |
| `.stack` | — | Vertical group spacing |

Motion is limited to the switch, the radio and the toast and turns off with `prefers-reduced-motion`.

## Pages
- **Popup** (`src/popup/`, 400 px wide; the content stays under Chrome's 600 px popup height): the bookmark that names the current tab (name field with its "Page title" switch, why it is shown, and the scope as a choice list with the "address contains" text), "not a bookmark" with a primary "Bookmark this page", or "not available here".
- **Settings** (`src/options/`): heading, the "add the page's own title" switch (a surface with one `.row`), search, view (Folders / List), scope filter and order, all web bookmarks (by folder or as one list) with their "Page title" switch and scope select (and text field for "address contains"), "How it works" (a `.folder`, closed by default) with one row per scope in the order of the select, which bookmark wins, links.
- **Context menu:** four radio items on web pages, one per scope, that mirror the active tab.

Texts come from `_locales/` (`en`, `hr`) through `src/ui/i18n.js`; nothing visible is hard-coded in HTML.
