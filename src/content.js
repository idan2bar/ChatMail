import * as InboxSDK from '@inboxsdk/core';

// Register your own app id at https://www.inboxsdk.com/register
const APP_ID = 'sdk_Better-Gmail_9f9db1f03f';
const PANEL_ID = 'better-gmail-side-panel';

/**
 * Finds the nearest common ancestor of two elements.
 */
function commonAncestor(a, b) {
  for (let node = a; node; node = node.parentElement) {
    if (node.contains(b)) return node;
  }
  return null;
}

/**
 * Returns the child of `parent` that contains `el`.
 */
function childContaining(parent, el) {
  let node = el;
  while (node && node.parentElement !== parent) node = node.parentElement;
  return node;
}

const WIDTH_KEY = 'chatmail:panelWidth';
const MIN_WIDTH = 160;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;

const clampWidth = (w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

function loadWidth() {
  try {
    const w = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(w)) return clampWidth(w);
  } catch {}
  return DEFAULT_WIDTH;
}

function saveWidth(w) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {}
}

// Persists the selected contact per tab, so reloading the Gmail tab keeps the card selected and
// its search showing instead of landing back on a deselected page. sessionStorage (not
// localStorage) keeps this from leaking into other tabs/windows.
const SELECTION_KEY = 'chatmail:selectedContact';

function loadSelection() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY));
    if (saved && typeof saved.address === 'string' && typeof saved.name === 'string') return saved;
  } catch {}
  return null;
}

function saveSelection(selection) {
  try {
    if (selection) sessionStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
    else sessionStorage.removeItem(SELECTION_KEY);
  } catch {}
}

function setWidth(panel, w) {
  panel.style.flexBasis = `${w}px`;
  panel.style.width = `${w}px`;
}

/**
 * The right-edge drag handle. Pointer capture keeps the drag alive outside the
 * handle, and user-select is disabled on the page while dragging.
 */
function createResizeHandle(panel) {
  const handle = document.createElement('div');
  Object.assign(handle.style, {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    width: '6px',
    cursor: 'col-resize',
    touchAction: 'none',
    userSelect: 'none',
    zIndex: '1',
  });
  let startX = 0;
  let startWidth = 0;
  let prevUserSelect = '';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    handle.style.background = 'rgba(26,115,232,0.35)';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    setWidth(panel, clampWidth(startWidth + e.clientX - startX));
  });
  const end = (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = prevUserSelect;
    handle.style.background = '';
    saveWidth(clampWidth(panel.getBoundingClientRect().width));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return handle;
}

/**
 * Makes the panel end at the same bottom edge as the main mail area, whatever
 * gap Gmail leaves below it inside the shared row.
 */
function alignBottom(panel, container, mainArea, listEl) {
  // Gmail's white card sits inside the main area; take the outermost ancestor
  // of the list that stops short of the row's bottom edge.
  const chain = [];
  for (let n = listEl; n && n !== container; n = n.parentElement) chain.unshift(n);
  const sync = () => {
    const bottom = container.getBoundingClientRect().bottom;
    const card = chain.find((n) => bottom - n.getBoundingClientRect().bottom > 1) || mainArea;
    const gap = bottom - card.getBoundingClientRect().bottom;
    panel.style.marginBottom = `${Math.max(0, Math.round(gap))}px`;
  };
  const ro = new ResizeObserver(sync);
  ro.observe(container);
  chain.forEach((n) => ro.observe(n));
  window.addEventListener('resize', sync);
  sync();
}

/**
 * When the menu is collapsed Gmail overlays it on the content row and reserves its width as
 * empty space between the panel and the main area, leaving the panel under the menu icons.
 * Move that space to the panel's left: measure the gap the panel's natural position leaves
 * before the main area, then shift the panel right by it and shrink its right margin by the
 * same amount so the main area doesn't move.
 */
function shiftClearOfMenu(panel, container, mainArea) {
  const GAP = 8; // the panel's normal right margin
  const sync = () => {
    panel.style.marginLeft = '0px';
    panel.style.marginRight = `${GAP}px`;
    const { left, width } = panel.getBoundingClientRect();
    const shift = Math.max(0, Math.round(mainArea.getBoundingClientRect().left - (left + width + GAP)));
    panel.style.marginLeft = `${shift}px`;
    panel.style.marginRight = `${GAP - shift}px`;
  };
  const ro = new ResizeObserver(sync);
  ro.observe(container);
  ro.observe(mainArea);
  container.addEventListener('transitionend', sync);
  window.addEventListener('resize', sync);
  sync();
}

/**
 * The panel is a non-scrolling flex-column wrapper holding a scrollable list
 * (`panel.list`, which renderContacts fills) and the resize handle.
 */
function createPanel() {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  const width = loadWidth();
  Object.assign(panel.style, {
    alignSelf: 'stretch', // fill the available height of the flex row
    flex: `0 0 ${width}px`,
    width: `${width}px`,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '0',
    contain: 'size', // its content never contributes to the row's height
    boxSizing: 'border-box',
    margin: '0 8px 0 0',
    borderRadius: '16px',
    background: '#fff',
    overflow: 'hidden',
    font: '14px/1.4 "Google Sans", Roboto, Arial, sans-serif',
  });

  const list = document.createElement('div');
  Object.assign(list.style, {
    flex: '1 1 auto',
    minHeight: '0',
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'none',
    padding: '4px',
  });
  const hideBar = document.createElement('style');
  hideBar.textContent =
    `#${PANEL_ID} > div::-webkit-scrollbar { display: none; }` +
    '@keyframes chatmail-spin { to { transform: rotate(360deg); } }' +
    // With no cards yet the spinner is the list's only child: center it in the whole panel.
    `#${PANEL_ID} > div > [role="status"]:only-child { position: absolute; inset: 0; align-items: center; padding: 0; pointer-events: none; }`;
  panel.append(hideBar);
  panel.list = list;

  // Shown below the last card while the next batch loads (renderContacts keeps it last).
  const spinner = document.createElement('div');
  spinner.hidden = true;
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Loading more contacts');
  Object.assign(spinner.style, { display: 'flex', justifyContent: 'center', padding: '20px 0' });
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    width: '28px',
    height: '28px',
    boxSizing: 'border-box',
    border: '3px solid transparent',
    borderTopColor: '#1a73e8',
    borderRadius: '50%',
    animation: 'chatmail-spin 0.8s linear infinite',
  });
  spinner.append(ring);
  panel.spinner = spinner;
  list.append(spinner);
  panel.append(list, createResizeHandle(panel));
  return panel;
}

// --- Contact list -----------------------------------------------------------

const GRAY = '#5f6368';
const USER_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff" aria-hidden="true">' +
  '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z"/></svg>';

let selectedAddress = null;

function createCard({ address, name, subject, unread }) {
  const card = document.createElement('div');
  card.dataset.address = address;
  card.setAttribute('role', 'option');
  card.tabIndex = 0;
  const selected = address === selectedAddress;
  card.setAttribute('aria-selected', String(selected));
  Object.assign(card.style, {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    borderRadius: '12px',
    cursor: 'pointer',
    background: selected ? 'rgba(26,115,232,0.16)' : 'transparent',
  });

  const avatar = document.createElement('div');
  Object.assign(avatar.style, {
    flex: '0 0 36px',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: '#9aa0a6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  avatar.innerHTML = USER_ICON;

  const text = document.createElement('div');
  Object.assign(text.style, { minWidth: 0, flex: '1 1 auto' });
  const nameEl = document.createElement('div');
  nameEl.textContent = name || address;
  nameEl.title = address;
  const subjectEl = document.createElement('div');
  subjectEl.textContent = subject;
  Object.assign(subjectEl.style, { color: GRAY, fontSize: '12px' });
  for (const el of [nameEl, subjectEl]) {
    Object.assign(el.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  }
  nameEl.style.fontWeight = '500';
  text.append(nameEl, subjectEl);

  card.append(avatar, text);

  if (unread > 0) {
    const badge = document.createElement('div');
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.title = `${unread > 99 ? '99+' : unread} unread`;
    Object.assign(badge.style, {
      position: 'absolute',
      top: '4px',
      right: '6px',
      minWidth: '18px',
      height: '18px',
      padding: '0 5px',
      boxSizing: 'border-box',
      borderRadius: '9px',
      background: '#1a73e8',
      color: '#fff',
      fontSize: '11px',
      fontWeight: '500',
      lineHeight: '18px',
      textAlign: 'center',
    });
    card.append(badge);
  }
  return card;
}

/**
 * Renders one card per address, in the order given (most recent mail first).
 * Cards are selectable; selection is kept in `selectedAddress` and announced
 * with a `chatmail:contactselect` event on the panel for later filtering.
 */
function renderContacts(panel, contacts) {
  panel.list.replaceChildren(...contacts.map(createCard), panel.spinner);
  panel.list.setAttribute('role', 'listbox');
}

/** Parses an address header ("Name <a@b.c>, d@e.f") into [{ address, name }]. */
function parseAddresses(header) {
  const out = [];
  const re = /(?:"([^"]*)"|([^",<]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  for (const m of header.matchAll(re)) {
    const address = (m[3] || m[4]).toLowerCase();
    out.push({ address, name: (m[1] || m[2] || '').trim() });
  }
  return out;
}

/** Shows a status line (e.g. an error) above the cards; empty text hides it. */
function showStatus(panel, text) {
  let el = panel.querySelector('[data-status]');
  if (!el) {
    el = document.createElement('div');
    el.dataset.status = '';
    Object.assign(el.style, { color: GRAY, fontSize: '12px', padding: '8px 12px' });
    panel.insertBefore(el, panel.list);
  }
  el.textContent = text;
  el.hidden = !text;
}

function setupSelection(panel, rerender, onSelect) {
  const toggle = (card) => {
    const address = card.dataset.address;
    selectedAddress = selectedAddress === address ? null : address;
    rerender();
    onSelect(selectedAddress);
    panel.dispatchEvent(new CustomEvent('chatmail:contactselect', { detail: { address: selectedAddress } }));
  };
  panel.addEventListener('click', (e) => {
    const card = e.target.closest('[data-address]');
    if (card) toggle(card);
  });
  panel.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('[data-address]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggle(card);
    }
  });
}

async function main() {
  const sdk = await InboxSDK.load(2, APP_ID);

  // Both elements below are handed to us by the SDK, so the panel position is
  // derived from them instead of from Gmail's internal class names or ids.
  let navEl = null;
  let listEl = null;
  let runWatch = null;

  // A nav item gives us a stable element inside the main (left) menu.
  sdk.NavMenu.addNavItem({ name: 'Chat Mail' }).getElement().then((el) => {
    navEl = el;
    mount();
  });

  const myAddress = sdk.User.getEmailAddress().toLowerCase();

  // Address -> { address, name, subject }, in order of most recent mail. Pages are
  // fetched newest-first, so the first time an address is seen is its latest mail.
  const contacts = new Map();
  let nextPageToken = undefined; // undefined: nothing loaded yet, null: no more pages
  let loading = false;

  const askBackground = (message) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res?.ok) reject(new Error(res?.error || 'No response'));
        else resolve(res.data);
      }),
    );

  function addMessages(messages) {
    for (const { subject, from, to, cc } of messages) {
      for (const { address, name } of parseAddresses([from, to, cc].join(','))) {
        if (address === myAddress || contacts.has(address)) continue;
        contacts.set(address, { address, name, subject: subject || '(no subject)' });
      }
    }
  }

  function refresh() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    renderContacts(
      panel,
      [...contacts.values()].map((c) => ({ ...c, unread: unreadCounts.get(c.address) || 0 })),
    );
  }

  // Address -> exact unread inbox count (capped at 100 by the background script; the
  // badge shows 99+). One Gmail search per address, requested as contacts get loaded.
  const unreadCounts = new Map();
  const unreadRequested = new Set();
  const UNREAD_BATCH = 10;

  async function loadUnreadCounts() {
    const pending = [...contacts.keys()].filter((a) => !unreadRequested.has(a));
    pending.forEach((a) => unreadRequested.add(a));
    for (let i = 0; i < pending.length; i += UNREAD_BATCH) {
      const addresses = pending.slice(i, i + UNREAD_BATCH);
      try {
        const counts = await askBackground({ type: 'chatmail:countUnread', addresses });
        for (const [address, n] of Object.entries(counts)) unreadCounts.set(address, n);
        refresh();
      } catch (err) {
        console.error('[ChatMail]', err);
        addresses.forEach((a) => unreadRequested.delete(a)); // retry with the next page load
      }
    }
  }

  /** Loads the next batch, and keeps going while the list doesn't fill the panel. */
  async function loadMore() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || loading || nextPageToken === null) return;
    loading = true;
    panel.spinner.hidden = false;
    try {
      const page = await askBackground({ type: 'chatmail:listInbox', pageToken: nextPageToken });
      nextPageToken = page.nextPageToken;
      addMessages(page.messages);
      showStatus(panel, '');
      refresh();
      loadUnreadCounts();
    } catch (err) {
      console.error('[ChatMail]', err);
      showStatus(panel, `Couldn't load contacts: ${err.message}`);
      loading = false;
      panel.spinner.hidden = true;
      return;
    }
    loading = false;
    panel.spinner.hidden = true;
    const list = panel.list;
    if (nextPageToken !== null && list.scrollHeight <= list.clientHeight + 40) loadMore();
  }

  // The SDK's query rewriter requires an `app:`/`has:` term (Gmail rejects anything else), so
  // it can't show a plain name. Instead, the real query runs as-is and the search box text is
  // reset to the contact's display name right after — the SDK has no API for the search box, so
  // this is a raw DOM fallback on the search input's stable `name="q"`. Gmail fills the box back
  // in after navigating, so it's set again shortly after too.
  function setSearchBoxText(text) {
    const set = () => {
      const input = document.querySelector('input[name="q"]');
      if (input && input.value !== text) input.value = text;
    };
    set();
    [100, 400, 1000].forEach((ms) => setTimeout(set, ms));
  }

  const queryFor = (address) => `in:inbox (from:${address} OR to:${address} OR cc:${address})`;

  // The query for the currently selected contact, so a route change can be recognized as "ours"
  // (a card selecting/deselecting itself) by content rather than by a flag — the same check also
  // recognizes the page's own reload landing back on that search, so restoring the saved selection
  // below doesn't immediately get read as a real search and cleared.
  let expectedQuery = null;

  // Restore the contact selected before a reload, so the panel and the search box right away
  // reflect the page Gmail already re-rendered, instead of flashing deselected.
  const saved = loadSelection();
  if (saved) {
    selectedAddress = saved.address;
    expectedQuery = queryFor(saved.address);
    setSearchBoxText(saved.name);
  }

  sdk.Router.handleAllRoutes((routeView) => {
    const isOurSearch =
      routeView.getRouteID() === sdk.Router.NativeRouteIDs.SEARCH && routeView.getParams().query === expectedQuery;
    if (isOurSearch) return;
    if (selectedAddress) {
      selectedAddress = null;
      expectedQuery = null;
      saveSelection(null);
      refresh();
    }
  });

  function onSelect(address) {
    // A real Gmail search over the whole mailbox; deselecting returns to the inbox.
    if (address) {
      const name = contacts.get(address).name || address;
      expectedQuery = queryFor(address);
      saveSelection({ address, name });
      sdk.Router.goto(sdk.Router.NativeRouteIDs.SEARCH, { query: expectedQuery, page: '1' });
      setSearchBoxText(name);
    } else {
      expectedQuery = null;
      saveSelection(null);
      sdk.Router.goto(sdk.Router.NativeRouteIDs.INBOX);
    }
  }

  // For a selected contact, Gmail shows a contact card (avatar, the address, an icon row repeating
  // it, chat actions) above the results, plus a row of search filter chips. The SDK has no API for
  // them (its hideSearchPageFilterToolbar CSS targets outdated selectors), so they're found by
  // content inside the SDK-anchored container, once the results have rendered. Before that the
  // mail list's table doesn't exist yet, so the card's "short text, no table" widening below would
  // run up into the element that is about to hold the list and hide it.
  function watchContactRow(root) {
    // Container of the filter row: it outlives the search page, so its styles are undone later.
    let filterContainer = null;
    const containerStyles = {
      'box-sizing': 'border-box',
      height: '44px',
      'min-height': '44px',
      'padding-top': '12px',
      'padding-bottom': '8px',
    };

    const run = () => {
      if (!expectedQuery) {
        for (const prop of Object.keys(containerStyles)) filterContainer?.style.removeProperty(prop);
        filterContainer = null;
        return;
      }
      if (!listEl || !listEl.isConnected) return;

      // Contact card: a leaf `role="contentinfo"` whose text is the address, widened to the largest
      // ancestor that is still just that card (short text, no mail-list table, not the panel).
      const address = selectedAddress.toLowerCase();
      const maxText = address.length * 6 + 150;
      for (const el of root.querySelectorAll('[role="contentinfo"]')) {
        if (el.children.length || el.textContent.trim().toLowerCase() !== address) continue;
        let card = el;
        while (
          card.parentElement &&
          card.parentElement !== root &&
          !card.parentElement.querySelector(`table, #${PANEL_ID}`) &&
          card.parentElement.textContent.length <= maxText
        ) {
          card = card.parentElement;
        }
        if (card !== el) card.style.display = 'none';
      }

      // Filter chips row: the toolbar holding the search's `data-query`. It's removed, and its
      // container (fixed height for two rows) is shrunk to the one remaining row plus padding.
      for (const q of root.querySelectorAll('[data-query]')) {
        const bar = q.dataset.query === expectedQuery && q.closest('[role="toolbar"]');
        if (!bar || bar.style.display === 'none') continue;
        bar.style.display = 'none';
        filterContainer = bar.parentElement;
        for (const [prop, value] of Object.entries(containerStyles)) {
          filterContainer.style.setProperty(prop, value, 'important');
        }
      }
    };
    runWatch = run;
    new MutationObserver(run).observe(root, { childList: true, subtree: true });
    run();
  }

  // Only used to find an anchor element inside the mail list for mounting.
  sdk.Lists.registerThreadRowViewHandler((row) => {
    listEl = row.getElement();
    mount();
    if (runWatch) setTimeout(runWatch, 200);
  });

  function mount() {
    if (!navEl || !listEl || !navEl.isConnected || !listEl.isConnected) return;
    if (document.getElementById(PANEL_ID)) return;

    // The row that lays out [menu][main area]: the lowest ancestor holding both.
    const container = commonAncestor(navEl, listEl);
    // The main white area (inbox tabs + list) is the child holding the list.
    const mainArea = container && childContaining(container, listEl);
    if (!mainArea) return;

    watchContactRow(container);

    const panel = createPanel();
    // InboxSDK expects the menu's next sibling to be the main area, so keep that DOM order
    // and place the panel between them visually with flex `order`: the panel and everything
    // before the main area sort first (in DOM order); the main area and what follows keep order 0.
    panel.style.order = '-1';
    for (let n = mainArea.previousElementSibling; n; n = n.previousElementSibling) n.style.order = '-1';
    mainArea.after(panel);
    shiftClearOfMenu(panel, container, mainArea);
    alignBottom(panel, container, mainArea, listEl);
    setupSelection(panel, refresh, onSelect);
    panel.list.addEventListener('scroll', () => {
      const l = panel.list;
      if (l.scrollTop + l.clientHeight >= l.scrollHeight - 80) loadMore();
    });
    refresh();
    loadMore();
  }
}

// The popup toggle stores this flag; enabled unless explicitly switched off.
chrome.storage.local
  .get('chatmail:enabled')
  .then((r) => (r['chatmail:enabled'] === false ? null : main()))
  .catch((err) => console.error('[ChatMail]', err));
