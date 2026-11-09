// Popup (A): the bookmark and the "keep on whole host" switch of the page in the current tab.
import { setKeepOnHost } from '../settings.js';
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
  if (document.activeElement !== $('name')) $('name').value = state.bookmark.title;
  $('opened-from').hidden = state.direct;
  $('host').textContent = state.host;
  $('keep').checked = state.keepOnHost;
  $('keep-hint').textContent = t('keepOnHostHint', state.host);
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

$('keep').addEventListener('change', async () => {
  if (state?.bookmark) await setKeepOnHost(state.bookmark.url, $('keep').checked);
});

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
