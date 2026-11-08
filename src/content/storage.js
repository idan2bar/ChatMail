// Persistence for the panel: its width and open state (localStorage, shared) and the selected
// contact (sessionStorage, per tab and account).

const WIDTH_KEY = 'chatmail:panelWidth';
const MIN_WIDTH = 160;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;

export const clampWidth = (w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

export function loadWidth() {
  try {
    const w = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(w)) return clampWidth(w);
  } catch {}
  return DEFAULT_WIDTH;
}

export function saveWidth(w) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {}
}

// Persists the selected contact per tab, so reloading the Gmail tab keeps the card selected and
// its search showing instead of landing back on a deselected page. sessionStorage (not
// localStorage) keeps this from leaking into other tabs/windows. The key includes the account, so a
// selection made in one Gmail account (/u/0, /u/1, ...) never shows up in another one in the same tab.
const SELECTION_KEY = 'chatmail:selectedContact';

export function loadSelection(account) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${SELECTION_KEY}:${account}`));
    if (saved && typeof saved.address === 'string' && typeof saved.name === 'string') return saved;
  } catch {}
  return null;
}

export function saveSelection(account, selection) {
  try {
    const key = `${SELECTION_KEY}:${account}`;
    if (selection) sessionStorage.setItem(key, JSON.stringify(selection));
    else sessionStorage.removeItem(key);
  } catch {}
}

// Whether the panel is shown; toggled by the nav item button. Open unless explicitly closed.
const OPEN_KEY = 'chatmail:panelOpen';

export function loadPanelOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function savePanelOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {}
}
