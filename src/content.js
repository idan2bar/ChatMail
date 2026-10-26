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
// localStorage) keeps this from leaking into other tabs/windows. The key includes the account, so a
// selection made in one Gmail account (/u/0, /u/1, ...) never shows up in another one in the same tab.
const SELECTION_KEY = 'chatmail:selectedContact';

function loadSelection(account) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${SELECTION_KEY}:${account}`));
    if (saved && typeof saved.address === 'string' && typeof saved.name === 'string') return saved;
  } catch {}
  return null;
}

function saveSelection(account, selection) {
  try {
    const key = `${SELECTION_KEY}:${account}`;
    if (selection) sessionStorage.setItem(key, JSON.stringify(selection));
    else sessionStorage.removeItem(key);
  } catch {}
}

// Whether the panel is shown; toggled by the nav item button. Open unless explicitly closed.
const OPEN_KEY = 'chatmail:panelOpen';

function loadPanelOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function savePanelOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {}
}

// Material "left panel close" / "left panel open" icons for the nav item button; it shows
// what a click will do.
const panelIcon = (path) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="24" height="24" fill="#444746" aria-hidden="true"><path d="${path}"/></svg>`;
const ICON_CLOSE_PANEL = panelIcon(
  'M660-320v-320L500-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z',
);
const ICON_OPEN_PANEL = panelIcon(
  'M500-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z',
);

/**
 * The menu button that opens/closes the panel: icon + label saying what a click will do, laid
 * out like Gmail's own menu items (icon centered 36px from the menu's edge, label at 72px). The
 * layout is the same in every state: in the collapsed menu the label starts past the button's
 * edge and is clipped, so there is no collapsed/expanded switch to jump when the menu animates.
 */
function createNavButton(onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  Object.assign(el.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '18px',
    boxSizing: 'border-box',
    width: 'calc(100% - 16px)',
    height: '40px',
    margin: '0 8px 8px',
    padding: '0 0 0 16px',
    border: '0',
    borderRadius: '20px',
    background: 'transparent',
    textAlign: 'left',
    overflow: 'hidden',
    // Text style of Gmail's menu items.
    userSelect: 'none',
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    textDecoration: 'none',
    webkitFontSmoothing: 'antialiased',
    fontFamily: '"Google Sans",Roboto,RobotoDraft,Helvetica,Arial,sans-serif',
    fontSize: '.875rem',
    letterSpacing: 'normal',
    color: 'rgb(32,33,36)',
    textShadow: 'none',
  });
  const icon = document.createElement('span');
  Object.assign(icon.style, { display: 'flex', flex: '0 0 24px' });
  const label = document.createElement('span');
  el.append(icon, label);
  el.addEventListener('mouseenter', () => (el.style.background = 'rgba(60,64,67,0.12)'));
  el.addEventListener('mouseleave', () => (el.style.background = 'transparent'));
  el.addEventListener('click', onClick);
  return {
    el,
    update(open) {
      icon.innerHTML = open ? ICON_CLOSE_PANEL : ICON_OPEN_PANEL;
      label.textContent = open ? 'Close Chat Mail' : 'Open Chat Mail';
    },
  };
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
    // Styled here rather than inline, since an inline `display` would override the `hidden` attribute.
    `#${PANEL_ID} > div > [role="status"]:not([hidden]) { display: flex; justify-content: center; padding: 20px 0; }` +
    // With no cards yet the spinner is the list's only child: center it in the whole panel.
    `#${PANEL_ID} > div > [role="status"]:only-child { position: absolute; inset: 0; align-items: center; padding: 0; pointer-events: none; }`;
  panel.append(hideBar);
  panel.list = list;

  // Shown below the last card while the next batch loads (renderContacts keeps it last).
  const spinner = document.createElement('div');
  spinner.hidden = true;
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Loading more contacts');
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

// One avatar element per address, reused by every re-render: a rebuilt avatar would show the generic
// icon again until its image reloaded, which flickers on each selection change.
const avatars = new Map();

/** Shows the first of `candidates` ({ url, logo }) that loads; the generic icon stays if none does. */
function loadAvatarImage(avatar, [candidate, ...rest]) {
  if (!candidate) return;
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  // A photo fills the circle; a logo sits inside it on white.
  Object.assign(img.style, { width: '100%', height: '100%', boxSizing: 'border-box' });
  if (candidate.logo) Object.assign(img.style, { objectFit: 'contain', padding: '6px' });
  else img.style.objectFit = 'cover';
  img.addEventListener('load', () => {
    avatar.style.background = candidate.logo ? '#fff' : '#9aa0a6';
    avatar.replaceChildren(img);
  });
  img.addEventListener('error', () => loadAvatarImage(avatar, rest));
  img.src = candidate.url;
}

function getAvatar(address, candidates) {
  let avatar = avatars.get(address);
  if (!avatar) {
    avatar = document.createElement('div');
    Object.assign(avatar.style, {
      flex: '0 0 36px',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: '#9aa0a6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    });
    avatar.innerHTML = USER_ICON;
    avatars.set(address, avatar);
  }
  const key = candidates.map((c) => c.url).join(' ');
  if (key && avatar.dataset.images !== key) {
    avatar.dataset.images = key;
    loadAvatarImage(avatar, candidates);
  }
  return avatar;
}

function createCard({ address, name, subject, unread, latestUnread, images }) {
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

  const avatar = getAvatar(address, images);

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
      background: latestUnread ? '#1a73e8' : '#9aa0a6', // blue: latest mail unread; gray: read
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

  // The nav item is the button that opens/closes the panel, and also gives us a stable element
  // inside the main (left) menu to anchor the panel on.
  let panelOpen = loadPanelOpen();
  const navButton = createNavButton(() => setPanelOpen(!panelOpen));
  navButton.update(panelOpen);

  sdk.NavMenu.addNavItem({ name: 'Chat Mail' })
    .getElement()
    .then((el) => {
      navEl = el;
      // The SDK's own item markup is hidden (it keeps working unseen) and replaced by our button.
      for (const child of navEl.children) child.style.display = 'none';
      Object.assign(navEl.style, { height: 'auto', minHeight: '0', background: 'none' });
      navEl.append(navButton.el);
      mount();
    });

  function setPanelOpen(open) {
    panelOpen = open;
    savePanelOpen(open);
    navButton.update(open);
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.style.display = open ? 'flex' : 'none';
    if (open) {
      // The margins that keep the panel clear of the collapsed menu were measured while it was hidden.
      window.dispatchEvent(new Event('resize'));
      loadMore();
    }
  }

  const myAddress = sdk.User.getEmailAddress().toLowerCase();

  // Address -> { address, name, subject }, in order of most recent mail. Pages are
  // fetched newest-first, so the first time an address is seen is its latest mail.
  const contacts = new Map();
  let nextPageToken = undefined; // undefined: nothing loaded yet, null: no more pages
  let loading = false;

  // Every background request is scoped to the account shown in this tab.
  const askBackground = (message) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({ ...message, account: myAddress }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res?.ok) reject(new Error(res?.error || 'No response'));
        else resolve(res.data);
      }),
    );

  function addMessages(messages) {
    for (const { id, unread, subject, from, to, cc } of messages) {
      for (const { address, name } of parseAddresses([from, to, cc].join(','))) {
        if (address === myAddress || contacts.has(address)) continue;
        contacts.set(address, { address, name, subject: subject || '(no subject)', latestId: id, latestUnread: unread });
      }
    }
  }

  function refresh() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    renderContacts(
      panel,
      [...contacts.values()].map((c) => ({
        ...c,
        unread: unreadCounts.get(c.address) || 0,
        images: avatarImages(c.address),
      })),
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

  // Address -> avatar image: the photo from the user's Google contacts, else the sender domain's
  // logo (a data URL the background script fetched). Cards show the generic icon until the image
  // has loaded, and keep it for addresses with neither.
  const photoUrls = new Map();
  const logoUrls = new Map();
  const photoRequested = new Set();

  function avatarImages(address) {
    if (photoUrls.has(address)) return [{ url: photoUrls.get(address) }];
    if (logoUrls.has(address)) return [{ url: logoUrls.get(address), logo: true }];
    return [];
  }

  async function loadPhotos() {
    const addresses = [...contacts.keys()].filter((a) => !photoRequested.has(a));
    addresses.forEach((a) => photoRequested.add(a));
    if (!addresses.length) return;
    try {
      const photos = await askBackground({ type: 'chatmail:photos', addresses });
      for (const [address, url] of Object.entries(photos)) photoUrls.set(address, url);
      // Showing a logo first and then the photo would flicker, so logos wait for the photo lookup.
      const rest = addresses.filter((a) => !photoUrls.has(a));
      const logos = rest.length ? await askBackground({ type: 'chatmail:favicons', addresses: rest }) : {};
      for (const [address, url] of Object.entries(logos)) logoUrls.set(address, url);
      refresh();
    } catch (err) {
      console.error('[ChatMail]', err);
      addresses.forEach((a) => photoRequested.delete(a)); // retry with the next page load
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
      loadPhotos();
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
    // A hidden panel has no height, so it would look unfilled and load the whole inbox.
    if (panelOpen && nextPageToken !== null && list.scrollHeight <= list.clientHeight + 40) loadMore();
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
  let selectedName = null;

  // Restore the contact selected before a reload, so the panel and the search box right away
  // reflect the page Gmail already re-rendered, instead of flashing deselected.
  const saved = loadSelection(myAddress);
  if (saved) {
    selectedAddress = saved.address;
    expectedQuery = queryFor(saved.address);
    selectedName = saved.name;
    setSearchBoxText(selectedName);
  }

  sdk.Router.handleAllRoutes((routeView) => {
    const routeID = routeView.getRouteID();
    // Opening a mail from the results is a THREAD route (no query param), still within the selection.
    const isOurSearch = routeID === sdk.Router.NativeRouteIDs.SEARCH && routeView.getParams().query === expectedQuery;
    if (isOurSearch || routeID === sdk.Router.NativeRouteIDs.THREAD) {
      // Gmail refills the search box with the raw query on every navigation within the selection.
      if (selectedAddress) setSearchBoxText(selectedName);
      return;
    }
    if (selectedAddress) {
      selectedAddress = null;
      expectedQuery = null;
      saveSelection(myAddress, null);
      refresh();
    }
  });

  function onSelect(address) {
    // A real Gmail search over the whole mailbox; deselecting returns to the inbox.
    if (address) {
      const name = contacts.get(address).name || address;
      expectedQuery = queryFor(address);
      selectedName = name;
      saveSelection(myAddress, { address, name });
      sdk.Router.goto(sdk.Router.NativeRouteIDs.SEARCH, { query: expectedQuery, page: '1' });
      setSearchBoxText(name);
    } else {
      expectedQuery = null;
      saveSelection(myAddress, null);
      sdk.Router.goto(sdk.Router.NativeRouteIDs.INBOX);
    }
  }

  // For a selected contact, Gmail shows a contact card (avatar, the address, an icon row repeating
  // it, chat actions) above the results, plus a row of search filter chips. The SDK has no API for
  // them (its hideSearchPageFilterToolbar CSS targets outdated selectors), so they're found by
  // content inside the SDK-anchored container. They're styled through marker attributes that are
  // recomputed on every change: a wrong guess made while the page is still rendering (e.g. the card
  // shows before the mail list's table exists, so the card's "no table" widening runs up into the
  // element about to hold the list) is corrected as soon as the table appears, and deselecting
  // simply clears the markers.
  function watchContactRow(root) {
    const HIDDEN = 'data-chatmail-hidden';
    const FILTERS = 'data-chatmail-filters';
    const style = document.createElement('style');
    style.textContent =
      `[${HIDDEN}] { display: none !important; }` +
      `[${FILTERS}] { box-sizing: border-box !important; height: 44px !important; min-height: 44px !important;` +
      ' padding-top: 12px !important; padding-bottom: 8px !important; }';
    document.head.append(style);

    // Puts `attr` on exactly the elements in `els`.
    const mark = (attr, els) => {
      for (const el of root.querySelectorAll(`[${attr}]`)) if (!els.has(el)) el.removeAttribute(attr);
      for (const el of els) if (!el.hasAttribute(attr)) el.setAttribute(attr, '');
    };

    const run = () => {
      const hidden = new Set();
      const filters = new Set();
      if (expectedQuery) {
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
          if (card !== el) hidden.add(card);
        }

        // Filter chips row: the toolbar holding the search's `data-query`. It's hidden, and its
        // container (fixed height for two rows) is shrunk to the one remaining row plus padding.
        for (const q of root.querySelectorAll('[data-query]')) {
          const bar = q.dataset.query === expectedQuery && q.closest('[role="toolbar"]');
          if (!bar) continue;
          hidden.add(bar);
          filters.add(bar.parentElement);
        }
      }
      mark(HIDDEN, hidden);
      mark(FILTERS, filters);
    };
    // Text and the chips' `data-query` can be filled in after the nodes exist (e.g. when returning
    // from a mail), so those changes are watched too; the markers themselves don't trigger it.
    new MutationObserver(run).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-query'],
    });
    run();
  }

  // Read/unread changes made in Gmail (in the list, in an open thread, on another device) show up in
  // the mailbox change log, which is polled with one cheap request. Each changed message moves the
  // badges of its contacts by +1 / -1. A count at the API's cap is left alone, since the real
  // number is unknown.
  const POLL_MS = 1000;
  let historyId;
  let polling = false;

  async function pollUnreadChanges() {
    if (polling || document.hidden) return; // only the visible (active) tab polls
    polling = true;
    try {
      const res = await askBackground({ type: 'chatmail:unreadChanges', historyId });
      historyId = res.historyId;
      if (res.changes.length) console.log('[ChatMail] unread changes', res.changes, [...unreadCounts]); // TEMP debug
      for (const { id, delta, from, to, cc } of res.changes) {
        for (const { address } of parseAddresses([from, to, cc].join(','))) {
          const contact = contacts.get(address);
          if (contact?.latestId === id) contact.latestUnread = delta > 0;
          const n = unreadCounts.get(address);
          if (n !== undefined && n < 100) unreadCounts.set(address, Math.max(0, n + delta));
        }
      }
      if (res.changes.length) refresh();
    } catch (err) {
      if (!chrome.runtime?.id) {
        // The extension was reloaded: this copy of the script is orphaned, a page reload brings the new one.
        clearInterval(pollTimer);
        console.warn('[ChatMail] Extension was reloaded; reload this tab.');
      } else {
        console.error('[ChatMail]', err);
      }
    } finally {
      polling = false;
    }
  }
  pollUnreadChanges();
  const pollTimer = setInterval(pollUnreadChanges, POLL_MS);
  document.addEventListener('visibilitychange', pollUnreadChanges); // catch up right away on returning

  // Only used to find an anchor element inside the mail list for mounting.
  sdk.Lists.registerThreadRowViewHandler((row) => {
    listEl = row.getElement();
    mount();
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
    if (!panelOpen) panel.style.display = 'none';
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
    if (panelOpen) loadMore();
  }
}

// The popup toggle stores this flag; enabled unless explicitly switched off.
// Loading Gmail applies the setting, so the popup's "refresh needed" note is cleared.
chrome.storage.local.set({ 'chatmail:refreshPending': false });
chrome.storage.local
  .get('chatmail:enabled')
  .then((r) => (r['chatmail:enabled'] === false ? null : main()))
  .catch((err) => console.error('[ChatMail]', err));
