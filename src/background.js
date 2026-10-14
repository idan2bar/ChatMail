// Required by InboxSDK on MV3: injects the SDK's page-world script into Gmail tabs.
import '@inboxsdk/core/background.js';

// --- Google API access --------------------------------------------------------
// The content script can't use chrome.identity, so it asks us for inbox pages (and contact photos).

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

const getToken = (interactive) => chrome.identity.getAuthToken({ interactive }).then((r) => r.token);

async function googleGet(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(true);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && attempt === 0) {
      await chrome.identity.removeCachedAuthToken({ token }); // stale token: refresh once
      continue;
    }
    if (!res.ok) {
      // Google's error body says why (API disabled, missing scope, not a test user, ...).
      const detail = await res.json().then((j) => j.error?.message, () => '');
      throw new Error(`Google API ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    // A `fields`-filtered response with nothing left in it (e.g. a search with no hits)
    // can come back with an empty body, which res.json() would reject.
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
}

const gmailGet = (path, params) => googleGet(`${API}/${path}?${params}`);

/** One page of inbox messages (newest first) with just the headers we display. */
async function listInboxPage(pageToken) {
  const list = new URLSearchParams({ labelIds: 'INBOX', maxResults: '25' });
  if (pageToken) list.set('pageToken', pageToken);
  const { messages = [], nextPageToken = null } = await gmailGet('messages', list);

  const details = await Promise.all(
    messages.map((m) => {
      const p = new URLSearchParams({ format: 'metadata' });
      for (const h of HEADERS) p.append('metadataHeaders', h);
      return gmailGet(`messages/${m.id}`, p);
    }),
  );
  const header = (msg, name) =>
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    nextPageToken,
    messages: details.map((msg) => ({
      subject: header(msg, 'Subject'),
      from: header(msg, 'From'),
      to: header(msg, 'To'),
      cc: header(msg, 'Cc'),
    })),
  };
}

const UNREAD_CAP = 100; // list at most this many ids; the UI shows 99+ beyond 99

/**
 * Exact unread inbox count for one address, capped at UNREAD_CAP. A single ids-only
 * list request: a full page of ids means "cap or more".
 */
async function countUnread(address) {
  const q = `in:inbox is:unread (from:${address} OR to:${address} OR cc:${address})`;
  const params = new URLSearchParams({ q, maxResults: String(UNREAD_CAP), fields: 'messages/id' });
  const { messages = [] } = await gmailGet('messages', params);
  return messages.length;
}

/** Counts for several addresses -> { address: count }. */
async function countUnreadMany(addresses) {
  const counts = await Promise.all(addresses.map(countUnread));
  return Object.fromEntries(addresses.map((a, i) => [a, counts[i]]));
}

// --- Contact photos (People API) ----------------------------------------------
// Photos come from the user's own Google contacts: saved contacts (`connections`) and people they
// have emailed (`otherContacts`). The lists are downloaded once and matched locally, so no email
// address is ever sent anywhere; the photo itself is a googleusercontent.com URL.

const PEOPLE = 'https://people.googleapis.com/v1';

/** Every person of one People API list as { emailAddresses, photos }, following the pages. */
async function listPeople(path, listKey, maskParam) {
  const people = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      [maskParam]: 'emailAddresses,photos',
      pageSize: '1000',
      fields: `nextPageToken,${listKey}(emailAddresses/value,photos(url,default))`,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await googleGet(`${PEOPLE}/${path}?${params}`);
    people.push(...(page[listKey] || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return people;
}

let photoIndex; // Promise<Map<address, photo url>>, built on first use

function loadPhotoIndex() {
  photoIndex ??= Promise.all([
    listPeople('people/me/connections', 'connections', 'personFields'), // first: saved contacts win
    listPeople('otherContacts', 'otherContacts', 'readMask'),
  ]).then((lists) => {
    const index = new Map();
    for (const person of lists.flat()) {
      const photo = person.photos?.find((p) => !p.default); // `default` is Google's placeholder silhouette
      if (!photo) continue;
      for (const { value } of person.emailAddresses || []) {
        const address = value.toLowerCase();
        if (!index.has(address)) index.set(address, photo.url);
      }
    }
    return index;
  });
  photoIndex.catch(() => (photoIndex = undefined)); // retry on the next request
  return photoIndex;
}

/** -> { address: photo url } for the addresses that have a photo. */
async function photosFor(addresses) {
  const index = await loadPhotoIndex();
  return Object.fromEntries(addresses.filter((a) => index.has(a)).map((a) => [a, index.get(a)]));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let work;
  if (msg?.type === 'chatmail:listInbox') work = listInboxPage(msg.pageToken);
  else if (msg?.type === 'chatmail:countUnread') work = countUnreadMany(msg.addresses);
  else if (msg?.type === 'chatmail:photos') work = photosFor(msg.addresses);
  else return;
  work.then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: String(err.message || err) }),
  );
  return true; // async response
});
