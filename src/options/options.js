// Options page (B): every web bookmark with how far its name reaches.
import { hostOf, normalizeUrl, suggestText } from '../match.js';
import { getAllScopes, onScopesChanged, setScope } from '../settings.js';
import { localize, t } from '../ui/i18n.js';

const $ = (id) => document.getElementById(id);
const SAVE_DELAY_MS = 350;

localize();
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
// ?edit=<bookmark id>: opened from the context menu to type an "address contains" text.
const editId = new URLSearchParams(location.search).get('edit');

// Flat list of web bookmarks with their folder path ("Bookmarks bar › Work").
async function loadBookmarks() {
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes) {
      if (node.url && /^https?:/.test(node.url) && node.title.trim()) {
        out.push({ id: node.id, title: node.title.trim(), url: node.url, folder: path.join(' › ') });
      }
      if (node.children) walk(node.children, node.title ? [...path, node.title] : path);
    }
  };
  walk(await chrome.bookmarks.getTree(), []);
  return out;
}

const settingOf = (scopes, bookmark) => scopes.get(normalizeUrl(bookmark.url)) ?? { scope: 'exact' };

function showSetting(row, setting) {
  const select = row.querySelector('[data-field="scope"]');
  const text = row.querySelector('[data-field="text"]');
  select.value = setting.scope;
  text.hidden = setting.scope !== 'contains';
  if (document.activeElement !== text) text.value = setting.text ?? '';
}

function renderRow(bookmark, setting) {
  const row = $('row').content.firstElementChild.cloneNode(true);
  localize(row);
  const id = `scope-${bookmark.id}`;
  row.dataset.key = normalizeUrl(bookmark.url);
  row.dataset.id = bookmark.id;
  row.querySelector('[data-field="title"]').textContent = bookmark.title;
  const where = [hostOf(bookmark.url), bookmark.folder].filter(Boolean).join(' · ');
  row.querySelector('[data-field="where"]').textContent = where;
  row.querySelector('label').htmlFor = id;
  const select = row.querySelector('[data-field="scope"]');
  const text = row.querySelector('[data-field="text"]');
  select.id = id;
  select.setAttribute('aria-label', `${t('scopeLabel')}: ${bookmark.title}`);
  text.placeholder = t('containsPlaceholder');
  text.setAttribute('aria-label', `${t('scope_contains')}: ${bookmark.title}`);
  showSetting(row, setting);

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

function showCount(bookmarks, scopes) {
  const wider = bookmarks.filter((b) => settingOf(scopes, b).scope !== 'exact').length;
  $('count').textContent = t('optionsCount', String(wider), String(bookmarks.length));
}

async function render() {
  const [bookmarks, scopes] = await Promise.all([loadBookmarks(), getAllScopes()]);
  const query = $('search').value.trim().toLowerCase();
  const shown = bookmarks.filter((b) => !query || `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(query));

  $('list').replaceChildren(...shown.map((b) => renderRow(b, settingOf(scopes, b))));
  $('list').hidden = shown.length === 0;
  showCount(bookmarks, scopes);
  $('empty').hidden = shown.length > 0;
  $('empty-title').textContent = t(bookmarks.length ? 'optionsNoMatchTitle' : 'optionsNoBookmarksTitle');
  $('empty-body').textContent = t(bookmarks.length ? 'optionsNoMatchBody' : 'optionsNoBookmarksBody');
}

// Changed here, in the popup or in the context menu: update the rows and the count in place.
async function refreshScopes() {
  const [bookmarks, scopes] = await Promise.all([loadBookmarks(), getAllScopes()]);
  for (const row of $('list').children) showSetting(row, scopes.get(row.dataset.key) ?? { scope: 'exact' });
  showCount(bookmarks, scopes);
}

$('search').addEventListener('input', render);
onScopesChanged(refreshScopes);
for (const event of ['onCreated', 'onChanged', 'onRemoved', 'onMoved', 'onImportEnded']) {
  chrome.bookmarks[event].addListener(render);
}

await render();
if (editId) {
  const row = $('list').querySelector(`[data-id="${CSS.escape(editId)}"]`);
  const select = row?.querySelector('[data-field="scope"]');
  if (select) {
    row.scrollIntoView({ block: 'center' });
    select.value = 'contains';
    select.dispatchEvent(new Event('change'));
  }
}
