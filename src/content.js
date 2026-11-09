import * as InboxSDK from '@inboxsdk/core';
import { mailOwners } from './content/addresses.js';
import { renderContacts, setupSelection } from './content/cards.js';
import { alignBottom, findLayout, shiftClearOfMenu, watchContactRow } from './content/layout.js';
import { createAskBackground } from './content/messaging.js';
import { PANEL_ID, createNavButton, createPanel, showLoadError } from './content/panel.js';
import { loadPanelOpen, loadSelection, saveSelection, savePanelOpen } from './content/storage.js';

// Register your own app id at https://www.inboxsdk.com/register
const APP_ID = 'sdk_Better-Gmail_9f9db1f03f';

async function main() {
  const sdk = await InboxSDK.load(2, APP_ID);

  // This element is handed to us by the SDK, so the panel position is
  // derived from it instead of from Gmail's internal class names or ids.
  let navEl = null;

  // The current mount: { controller, panel, container, mainArea }. Aborting its controller undoes
  // everything the mount added (panel, style, observers, listeners). Declared up here so it exists
  // before any SDK callback can call mount().
  let mounted = null;

  // The query for the currently selected contact, so a route change can be recognized as "ours"
  // (a card selecting/deselecting itself) by content rather than by a flag — the same check also
  // recognizes the page's own reload landing back on that search, so restoring the saved selection
  // below doesn't immediately get read as a real search and cleared.
  let selectedAddress = null;
  let expectedQuery = null;
  let selectedName = null;

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
  let loadError = false; // the error row is shown: only its "Try again" button (or reopening the panel) retries

  // Every background request is scoped to the account shown in this tab.
  const askBackground = createAskBackground(myAddress);

  function addMessages(messages) {
    for (const { id, unread, subject, date, from, to, cc } of messages) {
      for (const { address, name } of mailOwners(myAddress, { from, to, cc })) {
        if (contacts.has(address)) continue;
        contacts.set(address, { address, name, subject: subject || '(no subject)', date, latestId: id, latestUnread: unread });
      }
    }
  }

  // Merges a fresh first inbox page into the loaded contacts: the page's contacts come first (newest
  // mail first), then the other loaded contacts in their previous order. Returns the addresses whose
  // latest mail is new or changed. `contacts` is replaced in place, other code holds the Map.
  function mergeLatestPage(messages) {
    const old = new Map(contacts);
    contacts.clear();
    addMessages(messages);
    const changed = [...contacts.values()].filter((c) => old.get(c.address)?.latestId !== c.latestId).map((c) => c.address);
    for (const [address, contact] of old) if (!contacts.has(address)) contacts.set(address, contact);
    return changed;
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
      selectedAddress,
    );
  }

  // Address -> exact unread inbox count (capped at 100 by the background script; the
  // badge shows 99+). One Gmail search per address, requested as contacts get loaded.
  const unreadCounts = new Map();
  const unreadRequested = new Set();
  const UNREAD_BATCH = 10;

  // Requests exact counts for the addresses, in batches. Returns the addresses whose batch failed.
  async function recountUnread(addresses) {
    const failed = [];
    for (let i = 0; i < addresses.length; i += UNREAD_BATCH) {
      const batch = addresses.slice(i, i + UNREAD_BATCH);
      try {
        const counts = await askBackground({ type: 'chatmail:countUnread', addresses: batch });
        for (const [address, n] of Object.entries(counts)) unreadCounts.set(address, n);
        refresh();
      } catch (err) {
        console.error('[ChatMail]', err);
        failed.push(...batch);
      }
    }
    return failed;
  }

  async function loadUnreadCounts() {
    const pending = [...contacts.keys()].filter((a) => !unreadRequested.has(a));
    pending.forEach((a) => unreadRequested.add(a));
    const failed = await recountUnread(pending);
    failed.forEach((a) => unreadRequested.delete(a)); // retry with the next page load
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
    loadError = false;
    showLoadError(panel, null);
    panel.spinner.hidden = false;
    try {
      const page = await askBackground({ type: 'chatmail:listInbox', pageToken: nextPageToken });
      nextPageToken = page.nextPageToken;
      addMessages(page.messages);
      refresh();
      loadUnreadCounts();
      loadPhotos();
    } catch (err) {
      console.error('[ChatMail]', err);
      loadError = true;
      showLoadError(panel, `Couldn't load contacts: ${err.message}`, loadMore);
    } finally {
      loading = false;
      panel.spinner.hidden = true;
    }
    if (loadError) return;
    const list = panel.list;
    // A hidden panel has no height, so it would look unfilled and load the whole inbox.
    if (panelOpen && nextPageToken !== null && list.scrollHeight <= list.clientHeight + 40) loadMore();
  }

  // The SDK's query rewriter requires an `app:`/`has:` term (Gmail rejects anything else), so
  // it can't show a plain name. Instead, the real query runs as-is and, once Gmail fills the
  // search box with it, the text is replaced by the contact's display name. Gmail appends a
  // trailing space, so values are compared trimmed. Only a box holding exactly `query` is
  // touched, so text the user types is never overwritten. Gmail may fill the
  // box late, so every frame is checked for a short window. The SDK has no API for the search
  // box, so this is a raw DOM fallback on the search input's stable `name="q"`.
  let searchBoxFrame = 0;
  function setSearchBoxText(query, text) {
    cancelAnimationFrame(searchBoxFrame);
    const end = performance.now() + 2000;
    const tick = () => {
      const input = document.querySelector('input[name="q"]');
      if (input && input.value.trim() === query.trim()) input.value = text;
      if (performance.now() < end) searchBoxFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  // Keep in sync with the unread-count query in background.js.
  const queryFor = (address) => `in:inbox (from:${address} OR (from:${myAddress} (to:${address} OR cc:${address})))`;

  // Restore the contact selected before a reload, so the panel and the search box right away
  // reflect the page Gmail already re-rendered, instead of flashing deselected.
  const saved = loadSelection(myAddress);
  if (saved) {
    selectedAddress = saved.address;
    expectedQuery = queryFor(saved.address);
    selectedName = saved.name;
    setSearchBoxText(expectedQuery, selectedName);
  }

  sdk.Router.handleAllRoutes((routeView) => {
    mount(); // cheap re-check: restores the panel if Gmail rebuilt its layout
    const routeID = routeView.getRouteID();
    // Opening a mail from the results is a THREAD route (no query param), still within the selection.
    const isOurSearch = routeID === sdk.Router.NativeRouteIDs.SEARCH && routeView.getParams().query === expectedQuery;
    if (isOurSearch || routeID === sdk.Router.NativeRouteIDs.THREAD) {
      // Gmail refills the search box with the raw query on every navigation within the selection.
      if (selectedAddress) setSearchBoxText(expectedQuery, selectedName);
      return;
    }
    if (selectedAddress) {
      selectedAddress = null;
      expectedQuery = null;
      saveSelection(myAddress, null);
      refresh();
    }
  });

  // The search box's X button only empties the box (an `input` event, no navigation), leaving the
  // selected contact's results up. Treat an emptied box as deselecting the contact.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (selectedAddress && mounted && t instanceof HTMLInputElement && t.name === 'q' && t.value === '') toggleContact(mounted.panel, selectedAddress);
  }, true);

  // A card was clicked: select it (or deselect it if it already was), then search / return to the inbox.
  function toggleContact(panel, address) {
    selectedAddress = selectedAddress === address ? null : address;
    refresh();
    onSelect(selectedAddress);
    panel.dispatchEvent(new CustomEvent('chatmail:contactselect', { detail: { address: selectedAddress } }));
  }

  function onSelect(address) {
    // A real Gmail search over the whole mailbox; deselecting returns to the inbox.
    if (address) {
      const name = contacts.get(address).name || address;
      expectedQuery = queryFor(address);
      selectedName = name;
      saveSelection(myAddress, { address, name });
      sdk.Router.goto(sdk.Router.NativeRouteIDs.SEARCH, { query: expectedQuery, page: '1' });
      setSearchBoxText(expectedQuery, name);
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
  // Runs are coalesced to one per animation frame. The style element and the observer are removed
  // when `signal` aborts.

  // Changes made in Gmail (new mail, read/unread, archive, trash, delete; in the list, in an open
  // thread, on another device) show up in the mailbox change log, which is polled with one cheap
  // request. Counts are never adjusted by +1/-1, they are always re-requested exactly for the
  // affected contacts. If the inbox's contents changed, its first page is re-fetched and merged,
  // so new mail brings its contacts to the top and the latest subjects stay current.
  const POLL_MS = 1000;
  let historyId;
  let polling = false;

  async function pollMailboxChanges() {
    if (polling || document.hidden) return; // only the visible (active) tab polls
    polling = true;
    try {
      const res = await askBackground({ type: 'chatmail:mailboxChanges', historyId });
      const affected = new Set();
      for (const { id, unread, from, to, cc } of res.messages) {
        for (const { address } of mailOwners(myAddress, { from, to, cc })) {
          const contact = contacts.get(address);
          if (!contact) continue;
          if (contact.latestId === id) contact.latestUnread = unread;
          affected.add(address);
        }
      }
      if (res.inboxChanged) {
        const page = await askBackground({ type: 'chatmail:listInbox' });
        mergeLatestPage(page.messages).forEach((a) => affected.add(a));
        refresh();
        loadUnreadCounts();
        loadPhotos();
      }
      // Only advance after everything above succeeded, so a failed poll is retried.
      historyId = res.historyId;
      refresh();
      await recountUnread(res.recountAll ? [...contacts.keys()] : [...affected]);
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
  pollMailboxChanges();
  const pollTimer = setInterval(pollMailboxChanges, POLL_MS);
  document.addEventListener('visibilitychange', pollMailboxChanges); // catch up right away on returning


  // Idempotent: called on load and on every navigation, it only does work when there is no panel in
  // the current layout (first time, or Gmail rebuilt that part of the page).
  function mount() {
    if (!navEl || !navEl.isConnected) return;

    // Everything is derived from the nav item, so mounting doesn't depend on the current
    // page having mail-list rows (empty folders, open emails, empty searches).
    const layout = findLayout(navEl);
    if (!layout) return;
    const { container, mainArea } = layout;

    if (mounted && mounted.panel.isConnected && mounted.container === container && mounted.mainArea === mainArea) return;
    mounted?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    watchContactRow(container, signal, () => (expectedQuery ? { address: selectedAddress, query: expectedQuery } : null));

    const panel = createPanel();
    mounted = { controller, panel, container, mainArea };
    signal.addEventListener('abort', () => {
      panel.remove();
      for (let n = mainArea.previousElementSibling; n; n = n.previousElementSibling) n.style.order = '';
    });
    if (!panelOpen) panel.style.display = 'none';
    // InboxSDK expects the menu's next sibling to be the main area, so keep that DOM order
    // and place the panel between them visually with flex `order`: the panel and everything
    // before the main area sort first (in DOM order); the main area and what follows keep order 0.
    panel.style.order = '-1';
    for (let n = mainArea.previousElementSibling; n; n = n.previousElementSibling) n.style.order = '-1';
    mainArea.after(panel);
    shiftClearOfMenu(panel, container, mainArea, signal);
    alignBottom(panel, container, mainArea, signal);
    setupSelection(panel, (address) => toggleContact(panel, address), signal);
    panel.list.addEventListener('scroll', () => {
      const l = panel.list;
      if (!loadError && l.scrollTop + l.clientHeight >= l.scrollHeight - 80) loadMore();
    }, { signal });
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
