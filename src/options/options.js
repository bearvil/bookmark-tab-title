// Options page (B): every web bookmark with how far its name reaches, by folder or as one list.
import { hostOf, normalizeUrl, SCOPES, suggestText } from '../match.js';
import { getAllScopes, getAppendPageTitle, onAppendPageTitleChanged, onScopesChanged, setAppendPageTitle, setScope } from '../settings.js';
import { localize, t } from '../ui/i18n.js';

const $ = (id) => document.getElementById(id);
const SAVE_DELAY_MS = 350;
// How the list is shown, per device: view, order and the folders left open.
const VIEW_KEY = 'optionsView';
const SORTS = ['browser', 'name', 'host', 'scope'];
const FILTERS = ['all', 'wider', ...SCOPES];
// "By reach" puts the bookmarks with a wider scope first, in the order of the scope select.
const SCOPE_ORDER = [...SCOPES.slice(1), 'exact'];
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

localize();
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
// ?edit=<bookmark id>: opened from the context menu to type an "address contains" text.
const editId = new URLSearchParams(location.search).get('edit');

let view = { mode: 'folders', sort: 'browser', open: [] };
let data = { folders: [], all: [] };
let scopes = new Map();

async function loadView() {
  try {
    const stored = (await chrome.storage.local.get(VIEW_KEY))[VIEW_KEY] ?? {};
    view = {
      mode: stored.mode === 'list' ? 'list' : 'folders',
      sort: SORTS.includes(stored.sort) ? stored.sort : 'browser',
      open: Array.isArray(stored.open) ? stored.open : [],
    };
  } catch {}
}

const saveView = () => chrome.storage.local.set({ [VIEW_KEY]: view }).catch(() => {});

// The bookmark tree with only web bookmarks and the folders above them; folder = "Bookmarks bar › Work".
async function loadBookmarks() {
  const all = [];
  const toFolder = (node, path) => ({
    id: node.id,
    title: node.title,
    children: (node.children ?? []).flatMap((child) => {
      if (child.children) return [toFolder(child, [...path, child.title])];
      if (!child.url || !/^https?:/.test(child.url) || !child.title.trim()) return [];
      const bookmark = { id: child.id, title: child.title.trim(), url: child.url, folder: path.join(' › ') };
      all.push(bookmark);
      return [bookmark];
    }),
  });
  const [root] = await chrome.bookmarks.getTree();
  return { folders: root.children.map((node) => toFolder(node, [node.title])), all };
}

const isFolder = (node) => Array.isArray(node.children);
const settingOf = (bookmark) => scopes.get(normalizeUrl(bookmark.url)) ?? { scope: 'exact' };

function matcher() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('filter').value;
  const inSearch = (b) => !query || `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(query);
  const inFilter = (b) => {
    const { scope } = settingOf(b);
    return filter === 'all' || (filter === 'wider' ? scope !== 'exact' : scope === filter);
  };
  return { inSearch, matches: (b) => inSearch(b) && inFilter(b), narrowed: Boolean(query) || filter !== 'all' };
}

// Within a folder (or the whole list): as in the browser, or by name, host or reach; folders first, by name.
function ordered(nodes) {
  if (view.sort === 'browser') return nodes;
  const key = {
    name: () => 0,
    host: (b) => hostOf(b.url),
    scope: (b) => SCOPE_ORDER.indexOf(settingOf(b).scope),
  }[view.sort];
  const byName = (a, b) => collator.compare(a.title, b.title);
  const folders = nodes.filter(isFolder).sort(byName);
  const bookmarks = nodes.filter((n) => !isFolder(n)).sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (typeof ka === 'number' ? ka - kb : collator.compare(ka, kb)) || byName(a, b);
  });
  return [...folders, ...bookmarks];
}

function showSetting(row, setting) {
  const select = row.querySelector('[data-field="scope"]');
  const text = row.querySelector('[data-field="text"]');
  row.dataset.scope = setting.scope;
  select.value = setting.scope;
  text.hidden = setting.scope !== 'contains';
  if (document.activeElement !== text) text.value = setting.text ?? '';
}

function renderRow(bookmark) {
  const row = $('row').content.firstElementChild.cloneNode(true);
  localize(row);
  const id = `scope-${bookmark.id}`;
  row.dataset.key = normalizeUrl(bookmark.url);
  row.dataset.id = bookmark.id;
  row.querySelector('[data-field="title"]').textContent = bookmark.title;
  // In the folder view the folder is already above the row.
  const where = [hostOf(bookmark.url), view.mode === 'list' && bookmark.folder].filter(Boolean).join(' · ');
  row.querySelector('[data-field="where"]').textContent = where;
  row.querySelector('label').htmlFor = id;
  const select = row.querySelector('[data-field="scope"]');
  const text = row.querySelector('[data-field="text"]');
  select.id = id;
  select.setAttribute('aria-label', `${t('scopeLabel')}: ${bookmark.title}`);
  text.placeholder = t('containsPlaceholder');
  text.setAttribute('aria-label', `${t('scope_contains')}: ${bookmark.title}`);
  showSetting(row, settingOf(bookmark));

  select.addEventListener('change', () => {
    if (select.value !== 'contains') return setScope(bookmark.url, select.value);
    text.value ||= suggestText(bookmark.url);
    text.hidden = false;
    text.focus();
    setScope(bookmark.url, 'contains', text.value);
  });
  let timer = null;
  const saveText = () => {
    clearTimeout(timer);
    timer = null;
    setScope(bookmark.url, 'contains', text.value);
  };
  text.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(saveText, SAVE_DELAY_MS);
  });
  text.addEventListener('blur', () => timer && saveText());
  return row;
}

// A folder with the bookmarks that pass the search and the filter; null when none is in it or below it.
function renderFolder(folder, match, openIds) {
  const content = ordered(folder.children).flatMap((node) => {
    if (!isFolder(node)) return match.matches(node) ? [renderRow(node)] : [];
    const sub = renderFolder(node, match, openIds);
    if (!sub) return [];
    const item = document.createElement('li');
    item.className = 'folder__item';
    item.append(sub);
    return [item];
  });
  if (!content.length) return null;
  const details = $('folder').content.firstElementChild.cloneNode(true);
  details.dataset.id = folder.id;
  details.querySelector('[data-field="name"]').textContent = folder.title;
  details.querySelector('.folder__list').append(...content);
  // Searching or filtering opens every folder with a match, without changing the folders left open.
  details.open = match.narrowed || openIds.has(folder.id);
  details.addEventListener('toggle', () => {
    if (matcher().narrowed) return;
    const open = new Set(view.open);
    if (details.open) open.add(folder.id);
    else open.delete(folder.id);
    view.open = [...open];
    saveView();
  });
  return details;
}

// Bookmarks and wider scopes in each folder (and the folders below it), as shown.
function showFolderCounts() {
  for (const details of $('tree').querySelectorAll('.folder')) {
    const rows = details.querySelectorAll('li[data-key]');
    const wider = details.querySelectorAll('li[data-key]:not([data-scope="exact"])').length;
    details.querySelector('[data-field="count"]').textContent = String(rows.length);
    const pill = details.querySelector('[data-field="wider"]');
    pill.hidden = wider === 0;
    pill.textContent = t('folderWider', String(wider));
  }
}

function showCounts() {
  const { inSearch } = matcher();
  const found = data.all.filter(inSearch);
  for (const option of $('filter').options) {
    const n = found.filter((b) => {
      const { scope } = settingOf(b);
      return option.value === 'all' || (option.value === 'wider' ? scope !== 'exact' : scope === option.value);
    }).length;
    option.textContent = `${t(`filter_${option.value}`)} (${n})`;
  }
  const wider = data.all.filter((b) => settingOf(b).scope !== 'exact').length;
  $('count').textContent = t('optionsCount', String(wider), String(data.all.length));
  showFolderCounts();
}

// Ancestors of a bookmark, to open its folders (?edit=).
function foldersAbove(id) {
  const path = [];
  const find = (folder) => {
    if (folder.children.some((n) => (isFolder(n) ? find(n) : n.id === id))) return path.push(folder.id) > 0;
    return false;
  };
  data.folders.some(find);
  return path;
}

function paint(openIds = new Set(view.open)) {
  const match = matcher();
  $('view-folders').checked = view.mode === 'folders';
  $('view-list').checked = view.mode === 'list';
  $('sort').value = view.sort;
  const folders = view.mode === 'folders' ? data.folders.map((f) => renderFolder(f, match, openIds)).filter(Boolean) : [];
  const rows = view.mode === 'list' ? ordered(data.all).filter(match.matches).map(renderRow) : [];
  $('tree').replaceChildren(...folders);
  $('list').replaceChildren(...rows);
  $('tree').hidden = folders.length === 0;
  $('list').hidden = rows.length === 0;
  showCounts();
  const none = folders.length === 0 && rows.length === 0;
  $('empty').hidden = !none;
  $('empty-title').textContent = t(data.all.length ? 'optionsNoMatchTitle' : 'optionsNoBookmarksTitle');
  $('empty-body').textContent = t(data.all.length ? 'optionsNoMatchBody' : 'optionsNoBookmarksBody');
}

async function render() {
  [data, scopes] = await Promise.all([loadBookmarks(), getAllScopes()]);
  paint();
}

// Changed here, in the popup or in the context menu: update the rows and the counts in place, so a row does not
// disappear from a filtered view while it is being edited.
async function refreshScopes() {
  scopes = await getAllScopes();
  for (const row of document.querySelectorAll('li[data-key]')) showSetting(row, scopes.get(row.dataset.key) ?? { scope: 'exact' });
  showCounts();
}

for (const value of FILTERS) $('filter').add(new Option(t(`filter_${value}`), value));
for (const value of SORTS) $('sort').add(new Option(t(`sort_${value}`), value));

// One switch for every bookmark: the page's own title after the bookmark name.
const showAppend = async () => ($('append-page-title').checked = await getAppendPageTitle());
$('append-page-title').addEventListener('change', (e) => setAppendPageTitle(e.target.checked));
onAppendPageTitleChanged(showAppend);
showAppend();

$('search').addEventListener('input', () => paint());
$('filter').addEventListener('change', () => paint());
$('sort').addEventListener('change', () => {
  view.sort = $('sort').value;
  saveView();
  paint();
});
for (const radio of document.querySelectorAll('[name="view"]')) {
  radio.addEventListener('change', () => {
    view.mode = radio.value;
    saveView();
    paint();
  });
}
onScopesChanged(refreshScopes);
for (const event of ['onCreated', 'onChanged', 'onRemoved', 'onMoved', 'onImportEnded']) {
  chrome.bookmarks[event].addListener(render);
}

await loadView();
await render();
if (editId) {
  if (view.mode === 'folders') paint(new Set([...view.open, ...foldersAbove(editId)]));
  const row = document.querySelector(`li[data-id="${CSS.escape(editId)}"]`);
  const select = row?.querySelector('[data-field="scope"]');
  if (select) {
    row.scrollIntoView({ block: 'center' });
    select.value = 'contains';
    select.dispatchEvent(new Event('change'));
  }
}
