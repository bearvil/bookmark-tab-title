// Keeps the tab title equal to the bookmark name, even when the page changes it (e.g. Gmail's unread count).
(() => {
  const OBSERVE = { childList: true, subtree: true, characterData: true };
  // The page's own title lives on <html>, so a second copy of this script (after an extension update)
  // still knows what to restore instead of mistaking the bookmark name for it.
  const root = document.documentElement;
  const ORIGINAL = 'bookmarkTabTitleOriginal';
  const MAX_PER_SECOND = 100;
  let wanted = null;
  let applied = null; // title set by the extension, so it is never mistaken for the page's own title
  let observer = null;
  let burst = 0;
  let burstStart = 0;

  const pageTitle = () => root.dataset[ORIGINAL] ?? document.title;

  function restore() {
    observer?.disconnect();
    observer = null;
    if (applied !== null && document.title === applied) document.title = pageTitle();
    delete root.dataset[ORIGINAL];
    applied = null;
  }

  function apply() {
    // Extension removed or updated: this copy of the script must not change anything any more.
    if (!chrome.runtime?.id) {
      restore();
      return;
    }
    if (wanted === null || document.title === wanted) return;
    // Another script keeps resetting the title: back off instead of fighting it forever.
    const now = performance.now();
    if (now - burstStart > 1000) {
      burstStart = now;
      burst = 0;
    }
    if (++burst > MAX_PER_SECOND) {
      observer?.disconnect();
      observer = null;
      setTimeout(observe, 2000);
      return;
    }
    if (document.title !== applied) root.dataset[ORIGINAL] = document.title;
    document.title = applied = wanted;
  }

  // While the page is parsing, <head> may not exist yet, so the whole document is observed until DOMContentLoaded.
  function observe() {
    if (wanted === null) return;
    observer?.disconnect();
    observer = new MutationObserver(apply);
    const target = document.head ?? root;
    observer.observe(target, OBSERVE);
    if (target !== document.head) document.addEventListener('DOMContentLoaded', observe, { once: true });
    apply();
  }

  function setWanted(title) {
    const hadTitle = wanted !== null;
    wanted = title || null;
    if (wanted !== null) {
      // A previous copy may already show the bookmark name; treat it as ours.
      if (root.dataset[ORIGINAL] !== undefined) applied = document.title;
      observe();
    } else if (hadTitle) {
      restore();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'set-title') setWanted(msg.title);
  });

  chrome.runtime.sendMessage({ type: 'get-title' }).then((res) => setWanted(res?.title), () => {});
})();
