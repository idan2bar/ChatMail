// One-off: saves the fictional demo senders as Google Contacts (with generated photos) in the TEST account.
// Uses ONLY: gmail users/me/profile (GET), people/me/connections (GET), people:createContact (POST),
// {resourceName}:updateContactPhoto (PATCH). Never sends mail.
const CLIENT_ID = "165687420796-9d9suuoc08jllbv17idmsicrrdmbeacd.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const PEOPLE = "https://people.googleapis.com/v1";
const MUTATE_DELAY_MS = 1000;

const logEl = document.getElementById("log");
const log = (s) => {
  logEl.textContent += s + "\n";
  console.log("[demo-contacts] " + s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.demoContactsProgress = { done: 0, total: 0, state: "idle" };
window.demoContactsResult = null;

async function getToken(account) {
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "token",
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: SCOPE,
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
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (res.ok) return res.json();
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

function nameFields(sender) {
  const name = (sender.name || "").trim();
  if (sender.kind === "brand") return { givenName: name };
  const i = name.indexOf(" ");
  return i < 0 ? { givenName: name } : { givenName: name.slice(0, i), familyName: name.slice(i + 1).trim() };
}

async function loadExisting(token) {
  const map = new Map(); // email -> { resourceName, hasPhoto }
  let pageToken = "";
  do {
    const params = new URLSearchParams({ personFields: "emailAddresses,photos", pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const out = await api(token, `${PEOPLE}/people/me/connections?${params}`);
    for (const p of out.connections || []) {
      const hasPhoto = (p.photos || []).some((ph) => ph.default !== true);
      for (const e of p.emailAddresses || []) {
        if (e.value) map.set(e.value.toLowerCase(), { resourceName: p.resourceName, hasPhoto });
      }
    }
    pageToken = out.nextPageToken || "";
  } while (pageToken);
  return map;
}

async function run() {
  const account = document.getElementById("account").value.trim().toLowerCase();
  const progress = window.demoContactsProgress;
  progress.state = "auth";
  const token = await getToken(account);

  const profile = await api(token, GMAIL_PROFILE);
  if ((profile.emailAddress || "").toLowerCase() !== account) {
    throw new Error(`Safety check failed: token is for ${profile.emailAddress}, expected ${account}. Aborting.`);
  }
  log("Signed in as " + profile.emailAddress);

  const emails = await (await fetch("emails.json")).json();
  const senders = window.demoAvatarSenders(emails);
  const existing = await loadExisting(token);
  log(`${senders.length} senders, ${existing.size} existing contact emails`);

  progress.total = senders.length;
  progress.state = "running";
  const result = { created: 0, photosSet: 0, skipped: 0, failed: 0, errors: [] };

  for (const s of senders) {
    const email = s.email.toLowerCase();
    try {
      let entry = existing.get(email);
      let changed = false;
      if (!entry) {
        const out = await api(token, `${PEOPLE}/people:createContact`, {
          method: "POST",
          body: JSON.stringify({
            names: [nameFields(s)],
            emailAddresses: [{ value: s.email }],
            biographies: [{ value: "demo-mail sample contact" }],
          }),
        });
        entry = { resourceName: out.resourceName, hasPhoto: false };
        existing.set(email, entry);
        result.created++;
        changed = true;
        await sleep(MUTATE_DELAY_MS);
      }
      if (!entry.hasPhoto) {
        const photoBytes = await window.demoAvatarPng(window.demoAvatarSvg(s, s.kind));
        await api(token, `${PEOPLE}/${entry.resourceName}:updateContactPhoto`, {
          method: "PATCH",
          body: JSON.stringify({ photoBytes }),
        });
        entry.hasPhoto = true;
        result.photosSet++;
        changed = true;
        await sleep(MUTATE_DELAY_MS);
      }
      if (!changed) result.skipped++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${s.email}: ${err.message}`);
    }
    progress.done++;
    log(`${progress.done}/${progress.total} ${s.email}`);
  }

  log(`Done: created ${result.created}, photos set ${result.photosSet}, skipped ${result.skipped}, failed ${result.failed}`);
  result.errors.forEach((e) => log("error: " + e));
  progress.state = "finished";
  window.demoContactsResult = result;
}

document.getElementById("create").addEventListener("click", async (ev) => {
  ev.target.disabled = true;
  logEl.textContent = "";
  try {
    await run();
  } catch (err) {
    log("ABORTED: " + err.message);
    window.demoContactsProgress.state = "aborted";
    window.demoContactsResult = { aborted: true, error: err.message };
  } finally {
    ev.target.disabled = false;
  }
});
