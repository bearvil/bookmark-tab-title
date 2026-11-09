// "Keep the bookmark name on the whole host" — one switch per bookmark, shared by the popup, the options page
// and the context menu. Stored in storage.sync under the bookmark's normalized URL (bookmark ids differ per device).
import { normalizeUrl } from './match.js';

const PREFIX = 'keepOnHost:';

const keyFor = (url) => {
  const key = normalizeUrl(url);
  return key && PREFIX + key;
};

export async function getKeepOnHost(url) {
  const key = keyFor(url);
  return Boolean(key && (await chrome.storage.sync.get(key))[key]);
}

export async function setKeepOnHost(url, on) {
  const key = keyFor(url);
  if (!key) return;
  if (on) await chrome.storage.sync.set({ [key]: true });
  else await chrome.storage.sync.remove(key);
}

// Normalized URLs of every bookmark with the switch on.
export async function getAllKeepOnHost() {
  const all = await chrome.storage.sync.get(null);
  return new Set(Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)));
}

export function onKeepOnHostChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) callback();
  });
}
