// Popup (A): the bookmark that names the page in the current tab, and how far its name reaches.
import { hostOf, normalizeUrl, suggestText } from '../match.js';
import { getPageTitleFor, getScope, onPageTitleChanged, setPageTitleFor, setScope } from '../settings.js';
import { localize, t } from '../ui/i18n.js';

const $ = (id) => document.getElementById(id);
const SAVE_DELAY_MS = 350;

localize();
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

// ?tab=<id> shows a given tab, for when the popup is opened as a normal page (e.g. in tests).
const tabParam = Number(new URLSearchParams(location.search).get('tab'));
const tab = tabParam ? await chrome.tabs.get(tabParam) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
let state = null;
let saveTimer = null;
let savedTimer = null;

function show(id) {
  for (const section of ['state-bookmark', 'state-none', 'state-unsupported']) $(section).hidden = section !== id;
}

async function render() {
  state = tab ? await chrome.runtime.sendMessage({ type: 'tab-state', tabId: tab.id }) : { supported: false };
  if (!state?.supported) return show('state-unsupported');
  if (!state.bookmark) return show('state-none');
  show('state-bookmark');
  paint();
  showPageTitle();
}

// This bookmark's "add the page title": its own choice, else the option for every bookmark.
async function showPageTitle() {
  if (state?.bookmark) $('page-title').checked = await getPageTitleFor(state.bookmark.url);
}

// After a change the popup stays on the bookmark it opened with, even when the tab is now named by another one
// (or none): further changes must never land on a different bookmark.
async function refreshScope() {
  Object.assign(state, { scope: 'exact', text: undefined }, await getScope(state.bookmark.url));
  paint();
}

function paint() {
  const { bookmark } = state;
  const host = hostOf(bookmark.url);
  if (document.activeElement !== $('name')) $('name').value = bookmark.title;
  const because = { below: t('openedFrom'), host: t('openedFrom'), contains: t('shownContains', state.text) }[state.via];
  $('shown-because').hidden = !because;
  $('shown-because').textContent = because ?? '';
  $('shown-because').title = because ?? '';

  const address = normalizeUrl(bookmark.url);
  for (const radio of document.querySelectorAll('[name="scope"]')) radio.checked = radio.value === state.scope;
  document.querySelector('[data-detail="exact"]').textContent = address;
  document.querySelector('[data-detail="below"] [data-field="address"]').textContent = address.replace(/\?.*$/, '');
  document.querySelector('[data-detail="contains"]').textContent = t('containsDetail', host);
  document.querySelector('[data-detail="host"]').textContent = host;
  $('contains-row').hidden = state.scope !== 'contains';
  if (document.activeElement !== $('contains-text')) $('contains-text').value = state.text ?? '';
}

function flashSaved() {
  $('saved').dataset.visible = 'true';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').dataset.visible = 'false'), 1200);
}

async function saveName() {
  clearTimeout(saveTimer);
  const title = $('name').value.trim();
  if (!title || !state?.bookmark || title === state.bookmark.title) return;
  await chrome.bookmarks.update(state.bookmark.id, { title });
  state.bookmark.title = title;
  flashSaved();
}

$('name').addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveName, SAVE_DELAY_MS);
});
$('name').addEventListener('blur', saveName);
$('name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveName().then(() => window.close());
});

let textTimer = null;

async function saveScope(scope) {
  clearTimeout(textTimer);
  const { url } = state.bookmark;
  if (scope !== 'contains') {
    await setScope(url, scope);
    return refreshScope();
  }
  // Picking "contains" starts from the saved text or a suggestion from the bookmark's address.
  const text = state.text || suggestText(url);
  $('contains-text').value = text;
  $('contains-row').hidden = false;
  $('contains-text').focus();
  await setScope(url, 'contains', text);
  await refreshScope();
}

async function saveText() {
  clearTimeout(textTimer);
  textTimer = null;
  if (!state?.bookmark) return;
  await setScope(state.bookmark.url, 'contains', $('contains-text').value);
  flashSaved();
  await refreshScope();
}

$('scope').addEventListener('change', (event) => {
  if (event.target.name === 'scope' && state?.bookmark) saveScope(event.target.value);
});
$('contains-text').addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(saveText, SAVE_DELAY_MS);
});
$('contains-text').addEventListener('blur', () => textTimer && saveText());
$('contains-text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveText().then(() => window.close());
});

$('page-title').addEventListener('change', async (event) => {
  if (!state?.bookmark) return;
  await setPageTitleFor(state.bookmark.url, event.target.checked);
  flashSaved();
});
onPageTitleChanged(showPageTitle);

$('add-bookmark').addEventListener('click', async () => {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children?.[0];
  await chrome.bookmarks.create({ parentId: bar?.id, title: tab.title || state.host, url: tab.url });
  // Let the service worker see the new bookmark, then offer to name it right away.
  setTimeout(async () => {
    await render();
    $('name').focus();
    $('name').select();
  }, 150);
});

await render();
