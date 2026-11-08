// Panel chrome: the nav-menu toggle button, the panel element with its scrolling list and spinner,
// the resize handle and the status line.
import { GRAY } from './cards.js';
import { clampWidth, loadWidth, saveWidth } from './storage.js';

export const PANEL_ID = 'better-gmail-side-panel';

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
export function createNavButton(onClick) {
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
 * The panel is a non-scrolling flex-column wrapper holding a scrollable list
 * (`panel.list`, which renderContacts fills) and the resize handle.
 */
export function createPanel() {
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
    `#${PANEL_ID} [data-load-error]:not([hidden]) { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }` +
    `#${PANEL_ID} [data-load-error] > span { flex: 1 1 auto; min-width: 0; }` +
    `#${PANEL_ID} [data-load-error] > button:hover { background: #f1f3f4 !important; }` +
    // With no cards yet the spinner and the error are centered in the whole panel.
    `#${PANEL_ID} > div:not(:has([data-address])) > [role="status"] { position: absolute; inset: 0; align-items: center; padding: 0; pointer-events: none; }` +
    `#${PANEL_ID} > div:not(:has([data-address])) > [data-load-error] { position: absolute; inset: 0; flex-direction: column; justify-content: center; text-align: center; padding: 0 16px; }` +
    `#${PANEL_ID} > div:not(:has([data-address])) > [data-load-error] > span { flex: 0 0 auto; }`;
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

  // Load error with a retry button, shown below the last card (or centered when there are none);
  // renderContacts keeps it last. See showLoadError.
  const errorRow = document.createElement('div');
  errorRow.hidden = true;
  errorRow.dataset.loadError = '';
  const errorText = document.createElement('span');
  Object.assign(errorText.style, { color: GRAY, fontSize: '12px' });
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  Object.assign(retry.style, {
    flex: '0 0 auto',
    font: 'inherit',
    fontSize: '12px',
    fontWeight: '500',
    color: '#3c4043',
    background: 'transparent',
    border: '1px solid #dadce0',
    borderRadius: '16px',
    padding: '4px 12px',
    cursor: 'pointer',
  });
  retry.addEventListener('click', () => errorRow.onRetry());
  errorRow.append(errorText, retry);
  panel.errorRow = errorRow;
  list.append(spinner, errorRow);
  panel.append(list, createResizeHandle(panel));
  return panel;
}

/**
 * Shows the load error row (`panel.errorRow`, the list's last child): the message and a neutral
 * "Try again" button that calls `onRetry`. It sits below the last card, or is centered in the panel
 * (button under the text) when there are no cards. An empty message hides it.
 */
export function showLoadError(panel, message, onRetry) {
  const row = panel.errorRow;
  row.onRetry = onRetry;
  row.firstChild.textContent = message || '';
  row.hidden = !message;
}
