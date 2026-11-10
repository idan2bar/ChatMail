// Undoes what import.js / contacts.js created in the TEST account. Only touches:
//  - mail whose Message-ID ends with "@demo-mail.example>" (moved to Trash, never permanently deleted)
//  - contacts whose biography is exactly "demo-mail sample contact" (deleted)
// Never calls messages.delete / batchDelete, never sends mail.
const CLIENT_ID = "165687420796-9d9suuoc08jllbv17idmsicrrdmbeacd.apps.googleusercontent.com";
const SCOPE_MAIL = "https://www.googleapis.com/auth/gmail.modify";
const SCOPE_CONTACTS = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/gmail.readonly";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE = "https://people.googleapis.com/v1";
const MSGID_SUFFIX = "@demo-mail.example>";
const CONTACT_BIO = "demo-mail sample contact";
const MUTATE_DELAY_MS = 1000;
const MIN_GAP_MS = 100; // at most ~10 requests/second
let nextSlot = 0;
async function paceRequest() {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + MIN_GAP_MS;
  await sleep(at - Date.now());
}

const logEl = document.getElementById("log");
const log = (s) => {
  logEl.textContent += s + "\n";
  console.log("[demo-reset] " + s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.demoResetProgress = { done: 0, total: 0, state: "idle" };
window.demoResetResult = null;

async function getToken(account, scope) {
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "token",
      redirect_uri: chrome.identity.getRedirectURL(),
      scope,
      login_hint: account,
      prompt: "consent",
    });
  const redirect = await chrome.identity.launchWebAuthFlow({ interactive: true, url });
  const token = new URLSearchParams(new URL(redirect).hash.slice(1)).get("access_token");
  if (!token) throw new Error("No access_token in redirect: " + redirect);
  return token;
}

// Google error text (one line) and whether a 403 is a rate/quota limit.
function googleError(text) {
  try {
    const e = JSON.parse(text).error;
    return { message: String(e.message || text), reasons: (e.errors || []).map((x) => x.reason) };
  } catch {
    return { message: text.replace(/\s+/g, " ").trim(), reasons: [] };
  }
}
const isRateLimit = (status, g) =>
  status === 429 ||
  (status === 403 &&
    (g.reasons.some((r) => ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(r)) ||
      /Quota exceeded|Rate Limit Exceeded/i.test(g.message)));

async function api(token, url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    await paceRequest();
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
    const g = googleError(await res.text());
    const limited = isRateLimit(res.status, g);
    if ((limited || res.status >= 500) && attempt < 8) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const wait = retryAfter > 0 ? Math.min(retryAfter, 60) : Math.min(5 * 2 ** attempt, 60);
      log(`${limited ? "rate limited" : "server error " + res.status}, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${g.message}`.slice(0, 300));
  }
}

async function signIn(account, scope, progress) {
  progress.state = "auth";
  const token = await getToken(account, scope);
  const profile = await api(token, GMAIL + "/profile");
  if ((profile.emailAddress || "").toLowerCase() !== account) {
    throw new Error(`Safety check failed: token is for ${profile.emailAddress}, expected ${account}. Aborting.`);
  }
  log("Signed in as " + profile.emailAddress);
  return token;
}

async function trashMail(account) {
  const progress = window.demoResetProgress;
  const token = await signIn(account, SCOPE_MAIL, progress);
  progress.state = "scanning";

  const ids = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ maxResults: "500", includeSpamTrash: "false" });
    if (pageToken) params.set("pageToken", pageToken);
    const out = await api(token, `${GMAIL}/messages?${params}`);
    for (const m of out.messages || []) ids.push(m.id);
    pageToken = out.nextPageToken || "";
  } while (pageToken);
  log(`${ids.length} messages in mailbox, checking Message-ID headers`);

  const result = { scanned: 0, matched: 0, trashed: 0, failed: 0, errors: [] };
  const demoIds = [];
  progress.total = ids.length;
  for (const id of ids) {
    try {
      const m = await api(
        token,
        `${GMAIL}/messages/${id}?` +
          new URLSearchParams({ format: "metadata" }) +
          "&metadataHeaders=Message-ID"
      );
      const h = ((m.payload && m.payload.headers) || []).find((x) => x.name.toLowerCase() === "message-id");
      if (h && h.value.trim().endsWith(MSGID_SUFFIX)) demoIds.push(id);
    } catch (err) {
      result.failed++;
      result.errors.push(`scan ${id}: ${err.message}`);
    }
    result.scanned++;
    progress.done++;
    if (progress.done % 25 === 0 || progress.done === ids.length) log(`scanned ${progress.done}/${ids.length}`);
  }
  result.matched = demoIds.length;
  log(`${demoIds.length} demo messages found`);

  progress.state = "running";
  progress.done = 0;
  progress.total = demoIds.length;
  for (const id of demoIds) {
    try {
      await api(token, `${GMAIL}/messages/${id}/trash`, { method: "POST" });
      result.trashed++;
    } catch (err) {
      result.failed++;
      result.errors.push(`trash ${id}: ${err.message}`);
    }
    progress.done++;
    if (progress.done % 10 === 0 || progress.done === demoIds.length) log(`trashed ${progress.done}/${demoIds.length}`);
  }
  log(`Done: matched ${result.matched}, trashed ${result.trashed}, failed ${result.failed}`);
  result.errors.forEach((e) => log("error: " + e));
  progress.state = "finished";
  window.demoResetResult = { kind: "mail", ...result };
}

async function deleteContacts(account) {
  const progress = window.demoResetProgress;
  const token = await signIn(account, SCOPE_CONTACTS, progress);
  progress.state = "scanning";

  const found = [];
  let total = 0;
  let pageToken = "";
  do {
    const params = new URLSearchParams({ personFields: "biographies,emailAddresses", pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const out = await api(token, `${PEOPLE}/people/me/connections?${params}`);
    for (const p of out.connections || []) {
      total++;
      if ((p.biographies || []).some((b) => b.value === CONTACT_BIO)) {
        const email = ((p.emailAddresses || [])[0] || {}).value || "";
        found.push({ resourceName: p.resourceName, email });
      }
    }
    pageToken = out.nextPageToken || "";
  } while (pageToken);
  log(`${total} contacts, ${found.length} demo contacts found`);

  progress.state = "running";
  progress.total = found.length;
  const result = { scanned: total, matched: found.length, deleted: 0, failed: 0, errors: [] };
  for (const c of found) {
    try {
      await api(token, `${PEOPLE}/${c.resourceName}:deleteContact`, { method: "DELETE" });
      result.deleted++;
      await sleep(MUTATE_DELAY_MS);
    } catch (err) {
      result.failed++;
      result.errors.push(`${c.email || c.resourceName}: ${err.message}`);
    }
    progress.done++;
    log(`${progress.done}/${progress.total} ${c.email}`);
  }
  log(`Done: deleted ${result.deleted}, failed ${result.failed}`);
  result.errors.forEach((e) => log("error: " + e));
  progress.state = "finished";
  window.demoResetResult = { kind: "contacts", ...result };
}

function bind(id, fn) {
  const btn = document.getElementById(id);
  btn.addEventListener("click", async () => {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    logEl.textContent = "";
    window.demoResetProgress = { done: 0, total: 0, state: "idle" };
    window.demoResetResult = null;
    try {
      await fn(document.getElementById("account").value.trim().toLowerCase());
    } catch (err) {
      log("ABORTED: " + err.message);
      window.demoResetProgress.state = "aborted";
      window.demoResetResult = { aborted: true, error: err.message };
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
bind("trash", trashMail);
bind("contacts", deleteContacts);
