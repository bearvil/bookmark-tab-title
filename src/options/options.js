// Options page (B): every web bookmark with its "keep on whole host" switch.
import { hostOf, normalizeUrl } from '../match.js';
import { getAllKeepOnHost, onKeepOnHostChanged, setKeepOnHost } from '../settings.js';
import { localize, t } from '../ui/i18n.js';

const $ = (id) => document.getElementById(id);

localize();
$('version').textContent = `v${chrome.runtime.getManifest().version}`;

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

function renderRow(bookmark, keep) {
  const row = $('row').content.firstElementChild.cloneNode(true);
  const id = `keep-${bookmark.id}`;
  row.querySelector('[data-field="title"]').textContent = bookmark.title;
  const where = [hostOf(bookmark.url), bookmark.folder].filter(Boolean).join(' · ');
  row.querySelector('[data-field="where"]').textContent = where;
  row.querySelector('label').htmlFor = id;
  const toggle = row.querySelector('[data-field="keep"]');
  toggle.id = id;
  toggle.dataset.key = normalizeUrl(bookmark.url);
  toggle.checked = keep;
  toggle.setAttribute('aria-label', `${t('keepOnHostLabel')}: ${bookmark.title}`);
  toggle.addEventListener('change', () => setKeepOnHost(bookmark.url, toggle.checked));
  return row;
}

async function render() {
  const [bookmarks, keep] = await Promise.all([loadBookmarks(), getAllKeepOnHost()]);
  const query = $('search').value.trim().toLowerCase();
  const shown = bookmarks.filter((b) => !query || `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(query));
  const on = bookmarks.filter((b) => keep.has(normalizeUrl(b.url))).length;

  $('list').replaceChildren(...shown.map((b) => renderRow(b, keep.has(normalizeUrl(b.url)))));
  $('list').hidden = shown.length === 0;
  $('count').textContent = t('optionsCount', String(on), String(bookmarks.length));
  $('empty').hidden = shown.length > 0;
  $('empty-title').textContent = t(bookmarks.length ? 'optionsNoMatchTitle' : 'optionsNoBookmarksTitle');
  $('empty-body').textContent = t(bookmarks.length ? 'optionsNoMatchBody' : 'optionsNoBookmarksBody');
}

// A switch changed here, in the popup or in the context menu: update switches and count in place.
async function refreshKeep() {
  const keep = await getAllKeepOnHost();
  for (const toggle of $('list').querySelectorAll('.switch')) toggle.checked = keep.has(toggle.dataset.key);
  const bookmarks = await loadBookmarks();
  const on = bookmarks.filter((b) => keep.has(normalizeUrl(b.url))).length;
  $('count').textContent = t('optionsCount', String(on), String(bookmarks.length));
}

$('search').addEventListener('input', render);
onKeepOnHostChanged(refreshKeep);
for (const event of ['onCreated', 'onChanged', 'onRemoved', 'onMoved', 'onImportEnded']) {
  chrome.bookmarks[event].addListener(render);
}

render();
