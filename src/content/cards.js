// Contact cards: the cached avatar and card elements, rendering the list, and click/keyboard
// selection handling.

export const GRAY = '#5f6368';
const USER_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff" aria-hidden="true">' +
  '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z"/></svg>';

// One avatar element per address, reused by every re-render: a rebuilt avatar would show the generic
// icon again until its image reloaded, which flickers on each selection change.
const avatars = new Map();
const cards = new Map(); // address -> { key, card }, see renderContacts

/** Shows the first of `candidates` ({ url, logo }) that loads; the generic icon stays if none does. */
function loadAvatarImage(avatar, [candidate, ...rest]) {
  if (!candidate) return;
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  // Photos and logos both fill the circle.
  Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover' });
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

/** Like Gmail's mail list: the time for today's mail ("13:20"), else the day and month ("20 Sept"), with the year for older years. */
function formatMailDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  const opts = d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleDateString('en-GB', opts);
}

function createCard({ address, name, subject, date, unread, latestUnread, images }, selected) {
  const card = document.createElement('div');
  card.dataset.address = address;
  card.setAttribute('role', 'option');
  card.tabIndex = 0;
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

  const dateEl = document.createElement('div');
  dateEl.textContent = formatMailDate(date);
  Object.assign(dateEl.style, { color: GRAY, fontSize: '11px', whiteSpace: 'nowrap' });

  // Right column: date of the latest mail, with the unread badge below it.
  const side = document.createElement('div');
  Object.assign(side.style, { flex: '0 0 auto', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' });
  side.append(dateEl);
  card.append(avatar, text, side);

  if (unread > 0) {
    const badge = document.createElement('div');
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.title = `${unread > 99 ? '99+' : unread} unread`;
    Object.assign(badge.style, {
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
    side.append(badge);
  }
  return card;
}

/**
 * Renders one card per address, in the order given (most recent mail first).
 * `selectedAddress` is the currently selected contact's address (or null).
 */
export function renderContacts(panel, contacts, selectedAddress) {
  const { list } = panel;
  // Cards whose data didn't change are kept as they are: rebuilding all of them on every update
  // (counts, photos and polls arrive constantly) makes a long list flicker.
  const wanted = contacts.map((c) => {
    const key = JSON.stringify([c.name, c.subject, c.date, c.unread, c.latestUnread, c.images, c.address === selectedAddress]);
    let entry = cards.get(c.address);
    if (!entry || entry.key !== key) {
      entry = { key, card: createCard(c, c.address === selectedAddress) };
      cards.set(c.address, entry);
    }
    return entry.card;
  });
  wanted.push(panel.spinner, panel.errorRow); // always last, below the cards
  wanted.forEach((node, i) => {
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
  });
  while (list.children.length > wanted.length) list.lastElementChild.remove();
  list.setAttribute('role', 'listbox');
}

/** Click/keyboard selection of cards; the listeners are removed when `signal` aborts. */
export function setupSelection(panel, onToggle, signal) {
  panel.addEventListener('click', (e) => {
    const card = e.target.closest('[data-address]');
    if (card) onToggle(card.dataset.address);
  }, { signal });
  panel.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('[data-address]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onToggle(card.dataset.address);
    }
  }, { signal });
}
