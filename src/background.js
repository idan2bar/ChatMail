// Required by InboxSDK on MV3: injects the SDK's page-world script into Gmail tabs.
import '@inboxsdk/core/background.js';

// --- Google API access --------------------------------------------------------
// The content script can't use chrome.identity, so it asks us for inbox pages (and contact photos).

// A "Web application" OAuth client in the same Cloud project, with the authorized redirect URI
// `https://<extension-id>.chromiumapp.org/` (= chrome.identity.getRedirectURL()).
const OAUTH_CLIENT_ID = '165687420796-9d9suuoc08jllbv17idmsicrrdmbeacd.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];
const HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

// Every token and request is bound to the Gmail account of the tab that asked (`account`), never to
// the Chrome profile's default Google account.
const gmailBase = (account) => `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(account)}`;

const tokenKey = (account) => `chatmail:token:${account}`;
const tokenRequests = new Map(); // account -> in-flight Promise<token>, so one auth flow per account

/** Runs the OAuth implicit flow for `account` -> { token, expiresAt }. Silent unless `interactive`. */
async function runAuthFlow(account, interactive) {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPES.join(' '),
    login_hint: account,
  });
  if (!interactive) params.set('prompt', 'none');
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    interactive,
  });
  if (!redirect) throw new Error('Google sign-in returned no result');
  const result = new URLSearchParams(new URL(redirect).hash.slice(1));
  const token = result.get('access_token');
  if (!token) throw new Error(`Google sign-in failed: ${result.get('error') || 'no access token'}`);
  return { token, expiresAt: Date.now() + Number(result.get('expires_in') || 0) * 1000 };
}

/** Throws unless `token` belongs to `account`. */
async function verifyToken(account, token) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const email = res.ok ? (await res.json()).emailAddress : undefined;
  if (email?.toLowerCase() !== account) {
    throw new Error(`The signed-in Google account${email ? ` (${email})` : ''} does not match this Gmail tab (${account})`);
  }
}

async function fetchToken(account) {
  let auth;
  try {
    auth = await runAuthFlow(account, false);
  } catch {
    auth = await runAuthFlow(account, true); // needs the user (sign-in or first consent)
  }
  await verifyToken(account, auth.token); // never cache an unverified token
  await chrome.storage.session.set({ [tokenKey(account)]: auth });
  return auth.token;
}

async function getToken(account) {
  const key = tokenKey(account);
  const cached = (await chrome.storage.session.get(key))[key];
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  if (!tokenRequests.has(account)) {
    const request = fetchToken(account).finally(() => tokenRequests.delete(account));
    tokenRequests.set(account, request);
  }
  return tokenRequests.get(account);
}

async function googleGet(account, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(account);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && attempt === 0) {
      await chrome.storage.session.remove(tokenKey(account)); // stale token: refresh once
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

const gmailGet = (account, path, params) => googleGet(account, `${gmailBase(account)}/${path}?${params}`);

/** One page of inbox messages (newest first) with just the headers we display. */
async function listInboxPage(account, pageToken) {
  const list = new URLSearchParams({ labelIds: 'INBOX', maxResults: '25' });
  if (pageToken) list.set('pageToken', pageToken);
  const { messages = [], nextPageToken = null } = await gmailGet(account, 'messages', list);

  const details = await Promise.all(
    messages.map((m) => {
      const p = new URLSearchParams({ format: 'metadata' });
      for (const h of HEADERS) p.append('metadataHeaders', h);
      return gmailGet(account, `messages/${m.id}`, p);
    }),
  );
  const header = (msg, name) =>
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    nextPageToken,
    messages: details.map((msg) => ({
      id: msg.id,
      unread: !!msg.labelIds?.includes('UNREAD'),
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
async function countUnread(account, address) {
  const q = `in:inbox is:unread (from:${address} OR to:${address} OR cc:${address})`;
  const params = new URLSearchParams({ q, maxResults: String(UNREAD_CAP), fields: 'messages/id' });
  const { messages = [] } = await gmailGet(account, 'messages', params);
  return messages.length;
}

/** Counts for several addresses -> { address: count }. */
async function countUnreadMany(account, addresses) {
  const counts = await Promise.all(addresses.map((a) => countUnread(account, a)));
  return Object.fromEntries(addresses.map((a, i) => [a, counts[i]]));
}

/**
 * Read/unread changes of inbox mail since `historyId` (Gmail's mailbox change log), as
 * { historyId, changes: [{ delta, from, to, cc }] } with delta +1 (became unread) or -1 (was read).
 * Without a `historyId` it only returns the current one, as the starting point. One cheap call,
 * so it can be polled often, and it reports changes whichever way they were made in Gmail.
 */
async function unreadChanges(account, startHistoryId) {
  if (!startHistoryId) {
    const { historyId } = await gmailGet(account, 'profile', new URLSearchParams({ fields: 'historyId' }));
    return { historyId, changes: [] };
  }
  const events = [];
  let historyId = startHistoryId;
  let pageToken;
  do {
    const params = new URLSearchParams({ startHistoryId, labelId: 'UNREAD', maxResults: '100' });
    params.append('historyTypes', 'labelAdded');
    params.append('historyTypes', 'labelRemoved');
    if (pageToken) params.set('pageToken', pageToken);
    let page;
    try {
      page = await gmailGet(account, 'history', params);
    } catch (err) {
      if (String(err.message).startsWith('Google API 404')) return unreadChanges(account); // history too old: restart
      throw err;
    }
    historyId = page.historyId || historyId;
    pageToken = page.nextPageToken;
    for (const h of page.history || []) {
      for (const [list, delta] of [[h.labelsAdded, 1], [h.labelsRemoved, -1]]) {
        for (const e of list || []) {
          if (e.labelIds?.includes('UNREAD') && e.message.labelIds?.includes('INBOX')) {
            events.push({ id: e.message.id, delta });
          }
        }
      }
    }
  } while (pageToken);

  const header = (msg, name) =>
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const changes = await Promise.all(
    events.map(async ({ id, delta }) => {
      const p = new URLSearchParams({ format: 'metadata' });
      for (const h of ['From', 'To', 'Cc']) p.append('metadataHeaders', h);
      const msg = await gmailGet(account, `messages/${id}`, p);
      return { id, delta, from: header(msg, 'From'), to: header(msg, 'To'), cc: header(msg, 'Cc') };
    }),
  );
  return { historyId, changes };
}

// --- Contact photos (People API) ----------------------------------------------
// Photos come from the user's own Google contacts: saved contacts (`connections`) and people they
// have emailed (`otherContacts`). The lists are downloaded once and matched locally, so no email
// address is ever sent anywhere; the photo itself is a googleusercontent.com URL.

const PEOPLE = 'https://people.googleapis.com/v1';

/** Every person of one People API list as { emailAddresses, photos }, following the pages. */
async function listPeople(account, path, listKey, maskParam) {
  const people = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      [maskParam]: 'emailAddresses,photos',
      pageSize: '1000',
      fields: `nextPageToken,${listKey}(emailAddresses/value,photos(url,default))`,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await googleGet(account, `${PEOPLE}/${path}?${params}`);
    people.push(...(page[listKey] || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return people;
}

const photoIndexes = new Map(); // account -> Promise<Map<address, photo url>>, built on first use

function loadPhotoIndex(account) {
  if (photoIndexes.has(account)) return photoIndexes.get(account);
  const photoIndex = Promise.all([
    listPeople(account, 'people/me/connections', 'connections', 'personFields'), // first: saved contacts win
    listPeople(account, 'otherContacts', 'otherContacts', 'readMask'),
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
  photoIndexes.set(account, photoIndex);
  photoIndex.catch(() => photoIndexes.delete(account)); // retry on the next request
  return photoIndex;
}

/** -> { address: photo url } for the addresses that have a photo. */
async function photosFor(account, addresses) {
  const index = await loadPhotoIndex(account);
  return Object.fromEntries(addresses.filter((a) => index.has(a)).map((a) => [a, index.get(a)]));
}

// --- Sender logos (Google favicon service) ------------------------------------
// Fetched here rather than with <img> tags in the page: a domain without a favicon answers 404,
// and the page console logs every failed image load. Only the domain is sent, and only to Google.

// Free-mail providers: their favicon is the provider's logo, not the contact's.
const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com',
]);

const faviconCache = new Map(); // domain -> Promise<data URL | null>

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function faviconFor(domain) {
  if (!faviconCache.has(domain)) {
    const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
    faviconCache.set(
      domain,
      fetch(url, { credentials: 'omit' }).then(
        (res) => (res.ok ? res.blob().then(blobToDataUrl) : null), // 404: no favicon
        () => (faviconCache.delete(domain), null), // network error: try again next time
      ),
    );
  }
  return faviconCache.get(domain);
}

/** -> { address: data URL } using the sender domain's favicon, else its parent domain's (mail.acme.com -> acme.com). */
async function faviconsFor(addresses) {
  const entries = await Promise.all(
    addresses.map(async (address) => {
      const labels = address.slice(address.lastIndexOf('@') + 1).split('.');
      if (WEBMAIL.has(labels.join('.'))) return null;
      const domains = [labels.join('.')];
      if (labels.length > 2) domains.push(labels.slice(1).join('.'));
      for (const domain of domains) {
        const icon = await faviconFor(domain);
        if (icon) return [address, icon];
      }
      return null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

// Toolbar icon: on a Gmail tab it opens the popup (set per tab below); elsewhere the click handler activates a
// Gmail tab in the same window, else opens Gmail in a new tab there. (The host permission for mail.google.com
// lets tabs.query see tab URLs, so no extra permission is needed.)
const GMAIL = 'https://mail.google.com/*';
const enablePopup = (tabId) => {
  chrome.action.setPopup({ tabId, popup: 'main.html' });
  chrome.action.setTitle({ tabId, title: 'Click to open extension settings' });
};
chrome.action.setTitle({ title: 'Click to open Gmail' });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if ((change.url || change.status) && tab.url?.startsWith('https://mail.google.com/')) enablePopup(tabId);
});
// Tab-scoped popups are lost when the extension reloads; restore them for tabs that are already open.
chrome.tabs.query({ url: GMAIL }).then((tabs) => tabs.forEach((t) => enablePopup(t.id)));

chrome.action.onClicked.addListener(async ({ windowId }) => {
  const [gmail] = await chrome.tabs.query({ url: GMAIL, windowId });
  if (gmail) await chrome.tabs.update(gmail.id, { active: true });
  else await chrome.tabs.create({ windowId, url: 'https://mail.google.com/' });
});

// Every message carries `account`: the Gmail address (lowercased) of the tab that sent it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!String(msg?.type).startsWith('chatmail:')) return;
  const { account } = msg;
  let work;
  if (typeof account !== 'string' || !account) work = Promise.reject(new Error('Missing Gmail account in message'));
  else if (msg.type === 'chatmail:listInbox') work = listInboxPage(account, msg.pageToken);
  else if (msg.type === 'chatmail:countUnread') work = countUnreadMany(account, msg.addresses);
  else if (msg.type === 'chatmail:unreadChanges') work = unreadChanges(account, msg.historyId);
  else if (msg.type === 'chatmail:photos') work = photosFor(account, msg.addresses);
  else if (msg.type === 'chatmail:favicons') work = faviconsFor(msg.addresses);
  else return;
  work.then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: String(err.message || err) }),
  );
  return true; // async response
});
