// Keeps the tab title equal to the bookmark name, even when the page changes it (e.g. Gmail's unread count);
// with the "add the page's own title" option, the bookmark name followed by the page's current title.
(() => {
  const OBSERVE = { childList: true, subtree: true, characterData: true };
  // The page's own title lives on <html>, so a second copy of this script (after an extension update)
  // still knows what to restore instead of mistaking the bookmark name for it.
  const root = document.documentElement;
  const ORIGINAL = 'bookmarkTabTitleOriginal';
  const MAX_PER_SECOND = 100;
  const SEPARATOR = ' — ';
  let wanted = null;
  let append = false;
  let base = null; // the last title the page set as a whole, not as an edit of ours
  let applied = null; // title set by the extension, so it is never mistaken for the page's own title
  let observer = null;
  let burst = 0;
  let burstStart = 0;

  const pageTitle = () => root.dataset[ORIGINAL] ?? document.title;

  // document.title reads back with whitespace collapsed; the title is built the same way, so it compares equal.
  const collapse = (text) => text.replace(/[\t\n\f\r ]+/g, ' ').trim();
  // Some pages put markup in their title (e.g. an environment label as <div style="color:…">DEV</div>), which the
  // browser shows as text: only the text between the tags is added.
  const textOf = (title) => title.replace(/<\/?[a-z][^<>]*>/gi, ' ');
  // The page title without the bookmark name at its start or end ("E4 Admin" for "e4", "Inbox - Gmail" for "Gmail",
  // also "e4 — Inbox" when a page puts back a title it read from the tab), so the name is shown once.
  const EDGE = /^[\s\-–—|·:•]+|[\s\-–—|·:•]+$/g;
  const withoutName = (page, name) => {
    const n = name.toLowerCase();
    const word = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
    let rest = page;
    for (let changed = true; changed && rest; ) {
      changed = false;
      const lower = rest.toLowerCase();
      if (lower.startsWith(n) && !word(rest[n.length])) {
        rest = rest.slice(n.length).replace(EDGE, '');
        changed = true;
      } else if (lower.endsWith(n) && !word(rest[rest.length - n.length - 1])) {
        rest = rest.slice(0, rest.length - n.length).replace(EDGE, '');
        changed = true;
      }
    }
    return rest;
  };
  const titleFor = (own) => {
    const name = collapse(wanted);
    const page = withoutName(collapse(textOf(own)), name);
    return append && page && page !== name ? `${name}${SEPARATOR}${page}` : name;
  };

  function restore() {
    observer?.disconnect();
    observer = null;
    const shown = applied !== null && document.title === applied;
    if (shown) document.title = pageTitle();
    // An old copy left behind by an extension update that no longer shows the title must not take the page's own
    // title away from the new copy.
    if (shown || chrome.runtime?.id) delete root.dataset[ORIGINAL];
    applied = null;
  }

  function apply() {
    // Extension removed or updated: this copy of the script must not change anything any more.
    if (!chrome.runtime?.id) {
      restore();
      return;
    }
    if (wanted === null) return;
    // The page set a title of its own. With the page title added, a page that edits the current title
    // ("(1) " + document.title) edits ours: its edit is applied to the last title it set as a whole instead,
    // so the bookmark name is never repeated and the title does not grow.
    if (document.title !== applied) {
      if (append && applied?.includes(SEPARATOR) && document.title.includes(applied)) {
        root.dataset[ORIGINAL] = document.title.replace(applied, base ?? pageTitle());
      } else {
        base = document.title;
        root.dataset[ORIGINAL] = base;
      }
    }
    const next = titleFor(pageTitle());
    if (document.title === next) {
      applied = next;
      return;
    }
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
    document.title = applied = next;
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

  function setWanted(title, withPageTitle) {
    const hadTitle = wanted !== null;
    wanted = title || null;
    append = withPageTitle === true;
    if (wanted !== null) {
      // A previous copy may already show the bookmark name; treat it as ours.
      if (root.dataset[ORIGINAL] !== undefined) applied = document.title;
      observe();
    } else if (hadTitle) {
      restore();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'set-title') setWanted(msg.title, msg.append);
  });

  chrome.runtime.sendMessage({ type: 'get-title' }).then((res) => setWanted(res?.title, res?.append), () => {});
})();
