// Keeps the tab title equal to the bookmark name, even when the page changes it (e.g. Gmail's unread count).
(() => {
  const OBSERVE = { childList: true, subtree: true, characterData: true };
  let wanted = null;
  let applied = null; // title set by the extension, so it is never mistaken for the page's own title
  let pageTitle = document.title;
  let observer = null;

  function apply() {
    // Extension removed or updated: this copy of the script must not change anything any more.
    if (!chrome.runtime?.id) {
      observer?.disconnect();
      return;
    }
    if (wanted === null || document.title === wanted) return;
    if (document.title !== applied) pageTitle = document.title;
    document.title = applied = wanted;
  }

  // While the page is parsing, <head> may not exist yet, so the whole document is observed until DOMContentLoaded.
  function observe() {
    if (wanted === null) return;
    observer?.disconnect();
    observer = new MutationObserver(apply);
    const target = document.head ?? document.documentElement;
    observer.observe(target, OBSERVE);
    if (target !== document.head) document.addEventListener('DOMContentLoaded', observe, { once: true });
  }

  function setWanted(title) {
    const hadTitle = wanted !== null;
    wanted = title || null;
    if (wanted !== null) {
      observe();
      apply();
    } else if (hadTitle) {
      observer?.disconnect();
      observer = null;
      applied = null;
      document.title = pageTitle;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'set-title') setWanted(msg.title);
  });

  chrome.runtime.sendMessage({ type: 'get-title' }).then((res) => setWanted(res?.title), () => {});
})();
