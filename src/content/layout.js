// Gmail layout integration: finding the row/main area from an SDK element, keeping the panel
// aligned with Gmail's card, and hiding Gmail's contact card and filter chips for a selected contact.
import { PANEL_ID } from './panel.js';

/**
 * From the SDK's nav item element, finds the layout row ([menu column][main area]...) and the
 * main area. The menu column is the first ancestor of `navEl` whose parent is a row-direction
 * flex container (that parent is the row); InboxSDK itself relies on the menu column's next
 * sibling being the main area. Returns null if that structure isn't found.
 */
export function findLayout(navEl) {
  for (let menu = navEl.parentElement; menu && menu.parentElement; menu = menu.parentElement) {
    const style = getComputedStyle(menu.parentElement);
    if (style.display !== 'flex' || style.flexDirection !== 'row') continue;
    const mainArea = menu.nextElementSibling;
    return mainArea ? { container: menu.parentElement, mainArea } : null;
  }
  return null;
}

/**
 * Makes the panel end at the same bottom edge as Gmail's white card, whatever gap Gmail
 * leaves below it inside the shared row. The card is the main area's content, so the gap is
 * the row's bottom minus the lowest bottom of the main area's children (the main area itself
 * if it has none). Everything it sets up is torn down when `signal` aborts.
 */
export function alignBottom(panel, container, mainArea, signal) {
  const sync = () => {
    const bottom = container.getBoundingClientRect().bottom;
    const kids = [...mainArea.children];
    const cardBottom = kids.length
      ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))
      : mainArea.getBoundingClientRect().bottom;
    panel.style.marginBottom = `${Math.max(0, Math.round(bottom - cardBottom))}px`;
  };
  const ro = new ResizeObserver(sync);
  ro.observe(container);
  ro.observe(mainArea);
  const observeKids = () => [...mainArea.children].forEach((k) => ro.observe(k)); // re-observing is harmless
  observeKids();
  // Gmail swaps the main area's children (e.g. when switching views); follow the current ones.
  const mo = new MutationObserver(() => {
    observeKids();
    sync();
  });
  mo.observe(mainArea, { childList: true });
  window.addEventListener('resize', sync, { signal });
  signal.addEventListener('abort', () => {
    ro.disconnect();
    mo.disconnect();
  });
  sync();
}

/**
 * When the menu is collapsed Gmail overlays it on the content row and reserves its width as
 * empty space between the panel and the main area, leaving the panel under the menu icons.
 * Move that space to the panel's left: measure the gap the panel's natural position leaves
 * before the main area, then shift the panel right by it and shrink its right margin by the
 * same amount so the main area doesn't move. Everything it sets up is torn down when `signal` aborts.
 */
export function shiftClearOfMenu(panel, container, mainArea, signal) {
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
  container.addEventListener('transitionend', sync, { signal });
  window.addEventListener('resize', sync, { signal });
  signal.addEventListener('abort', () => ro.disconnect());
  sync();
}

// Longest textContent a contact card can have; anything longer is not just the card.
const MAX_CARD_TEXT = 400;

// For a selected contact, Gmail shows a contact card (avatar, a display name or the address, the
// address, chat actions) above the results, plus a row of search filter chips. The query has two
// `from:` addresses (the contact and the user), so Gmail may show the card for either one, and the
// card may show a display name rather than the address; it is therefore matched by mentioning any
// of `getSelection().addresses`. The SDK has no API for
// them (its hideSearchPageFilterToolbar CSS targets outdated selectors), so they're found by
// content inside the SDK-anchored container. They're styled through marker attributes that are
// recomputed on every change: a wrong guess made while the page is still rendering (e.g. the card
// shows before the mail list's table exists, so the card's "no table" widening runs up into the
// element about to hold the list) is corrected as soon as the table appears, and deselecting
// simply clears the markers.
// Runs are coalesced to one per animation frame. The style element and the observer are removed
// when `signal` aborts.
export function watchContactRow(root, signal, getSelection) {
  const HIDDEN = 'data-chatmail-hidden';
  const FILTERS = 'data-chatmail-filters';
  const style = document.createElement('style');
  style.textContent =
    `[${HIDDEN}] { display: none !important; }` +
    `[${FILTERS}] { box-sizing: border-box !important; height: 44px !important; min-height: 44px !important;` +
    ' padding-top: 12px !important; padding-bottom: 8px !important; }';
  document.head.append(style);
  signal.addEventListener('abort', () => style.remove());

  // Puts `attr` on exactly the elements in `els`.
  const mark = (attr, els) => {
    for (const el of root.querySelectorAll(`[${attr}]`)) if (!els.has(el)) el.removeAttribute(attr);
    for (const el of els) if (!el.hasAttribute(attr)) el.setAttribute(attr, '');
  };

  let marked = false; // whether the last run put any marker
  const run = () => {
    const selection = getSelection();
    if (!selection && !marked) return;
    const hidden = new Set();
    const filters = new Set();
    if (selection) {
      // Contact card: every `role="contentinfo"` is widened to the largest ancestor that is still
      // just a card (short text, no mail-list table, filter toolbar or panel, not `root`), and that
      // is hidden if it mentions one of the query's addresses. The set dedups the card's several
      // contentinfos; an unrelated one (the page footer) never mentions them.
      const addresses = selection.addresses.map((a) => a.toLowerCase());
      for (const el of root.querySelectorAll('[role="contentinfo"]')) {
        let card = el;
        while (
          card.parentElement &&
          card.parentElement !== root &&
          !card.parentElement.querySelector(`table, #${PANEL_ID}, [role="toolbar"]`) &&
          card.parentElement.textContent.length <= MAX_CARD_TEXT
        ) {
          card = card.parentElement;
        }
        const text = card.textContent.toLowerCase();
        if (addresses.some((a) => text.includes(a))) hidden.add(card);
      }

      // Filter chips row: the toolbar holding the search's `data-query`. It's hidden, and its
      // container (fixed height for two rows) is shrunk to the one remaining row plus padding.
      for (const q of root.querySelectorAll('[data-query]')) {
        const bar = q.dataset.query === selection.query && q.closest('[role="toolbar"]');
        if (!bar) continue;
        hidden.add(bar);
        filters.add(bar.parentElement);
      }
    }
    mark(HIDDEN, hidden);
    mark(FILTERS, filters);
    marked = hidden.size > 0 || filters.size > 0;
  };
  // Text and the chips' `data-query` can be filled in after the nodes exist (e.g. when returning
  // from a mail), so those changes are watched too; the markers themselves don't trigger it.
  let frame = 0;
  const mo = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      run();
    });
  });
  mo.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-query'],
  });
  signal.addEventListener('abort', () => {
    mo.disconnect();
    cancelAnimationFrame(frame);
    // The markers live on Gmail's elements, which outlive this mount; clear them.
    for (const attr of [HIDDEN, FILTERS]) for (const el of root.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  });
  run();
}
