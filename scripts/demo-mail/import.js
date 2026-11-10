// One-off demo mailbox filler. Uses ONLY: users/me/profile (GET), users/me/messages (GET list),
// users/me/messages?internalDateSource=dateHeader (POST insert). Never sends mail.
const CLIENT_ID = "165687420796-9d9suuoc08jllbv17idmsicrrdmbeacd.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/gmail.insert https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CATEGORY = {
  primary: "CATEGORY_PERSONAL",
  promotions: "CATEGORY_PROMOTIONS",
  updates: "CATEGORY_UPDATES",
  social: "CATEGORY_SOCIAL",
  forums: "CATEGORY_FORUMS",
};
const CONCURRENCY = 1;
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
  console.log("[demo-import] " + s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.demoImportProgress = { done: 0, total: 0, state: "idle" };
window.demoImportResult = null;

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
    return { message: text.replace(/s+/g, " ").trim(), reasons: [] };
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

// ---- RFC 822 helpers ----
const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
const utf8Base64 = (s) => bytesToBase64(new TextEncoder().encode(s));
const base64url = (s) => utf8Base64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function encodeWords(text) {
  if (isAscii(text)) return text;
  const chars = Array.from(text);
  const parts = [];
  for (let i = 0; i < chars.length; i += 20) {
    parts.push("=?UTF-8?B?" + utf8Base64(chars.slice(i, i + 20).join("")) + "?=");
  }
  return parts.join("\r\n ");
}

function formatAddress(a) {
  if (!a.name) return a.email;
  const name = isAscii(a.name) ? '"' + a.name.replace(/(["\\])/g, "\\$1") + '"' : encodeWords(a.name);
  return `${name} <${a.email}>`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rfc2822(d) {
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return (
    `${DAYS[d.getDay()]}, ${p(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`
  );
}

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function wrap76(b64) {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

// ---- build ----
function prepare(emails, account) {
  const me = { name: "Demo User", email: account };
  const resolve = (x) => (x === "ME" ? me : x);
  const now = new Date();
  const clampMax = new Date(now.getTime() - 60000);
  const items = emails.map((e, i) => {
    const [hh, mm] = e.time.split(":").map(Number);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - e.daysAgo, hh, mm, 0);
    return { e, i, date: d > clampMax ? clampMax : d };
  });
  // Sort by date ascending (stable via original index)
  items.sort((a, b) => a.date - b.date || a.i - b.i);
  const threadLast = new Map(); // thread key -> previous message-id
  return items.map((it, idx) => {
    const e = it.e;
    const fromMe = e.from === "ME";
    const from = resolve(e.from);
    const to = (e.to && e.to.length ? e.to : ["ME"]).map(resolve);
    const cc = (e.cc || []).map(resolve);
    const msgId = `demo-${idx}-${hash(e.subject + "|" + from.email)}@demo-mail.example`;
    const headers = [
      `From: ${formatAddress(from)}`,
      `To: ${to.map(formatAddress).join(", ")}`,
    ];
    if (cc.length) headers.push(`Cc: ${cc.map(formatAddress).join(", ")}`);
    headers.push(`Subject: ${encodeWords(e.subject)}`, `Date: ${rfc2822(it.date)}`, `Message-ID: <${msgId}>`);
    const prev = e.thread ? threadLast.get(e.thread) : null;
    if (prev) headers.push(`In-Reply-To: <${prev}>`, `References: <${prev}>`);
    if (e.thread) threadLast.set(e.thread, msgId);
    headers.push(
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64"
    );
    const raw = headers.join("\r\n") + "\r\n\r\n" + wrap76(utf8Base64(e.body.replace(/\r?\n/g, "\r\n"))) + "\r\n";
    const labelIds = fromMe ? ["SENT"] : ["INBOX", CATEGORY[e.category] || CATEGORY.primary];
    if (e.unread) labelIds.push("UNREAD");
    if (e.starred) labelIds.push("STARRED");
    return { msgId, raw: base64url(raw), labelIds, thread: e.thread || null, subject: e.subject };
  });
}

async function run() {
  const account = document.getElementById("account").value.trim().toLowerCase();
  const progress = window.demoImportProgress;
  progress.state = "auth";
  const token = await getToken(account);

  const profile = await api(token, API + "/profile");
  if ((profile.emailAddress || "").toLowerCase() !== account) {
    throw new Error(`Safety check failed: token is for ${profile.emailAddress}, expected ${account}. Aborting.`);
  }
  log("Signed in as " + profile.emailAddress);

  const emails = await (await fetch("emails.json")).json();
  const msgs = prepare(emails, account);
  progress.total = msgs.length;
  progress.state = "running";
  log(`Prepared ${msgs.length} messages`);

  const result = { total: msgs.length, inserted: 0, skipped: 0, failed: 0, errors: [] };
  const threadIds = new Map(); // thread key -> Gmail threadId

  async function handle(m) {
    const found = await api(
      token,
      `${API}/messages?` + new URLSearchParams({ q: "rfc822msgid:" + m.msgId, maxResults: "1" })
    );
    if (found.messages && found.messages.length) {
      if (m.thread) threadIds.set(m.thread, found.messages[0].threadId);
      result.skipped++;
      return;
    }
    const body = { raw: m.raw, labelIds: m.labelIds };
    if (m.thread && threadIds.has(m.thread)) body.threadId = threadIds.get(m.thread);
    const out = await api(token, `${API}/messages?internalDateSource=dateHeader`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (m.thread) threadIds.set(m.thread, out.threadId);
    result.inserted++;
  }

  // Messages of one thread run sequentially (in date order); different groups run in parallel.
  const groups = new Map();
  msgs.forEach((m, i) => {
    const key = m.thread ? "t:" + m.thread : "m:" + i;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  });
  const queue = [...groups.values()];

  async function worker() {
    while (queue.length) {
      const group = queue.shift();
      for (const m of group) {
        try {
          await handle(m);
        } catch (err) {
          result.failed++;
          result.errors.push(`${m.subject}: ${err.message}`);
        }
        progress.done++;
        log(`${progress.done}/${progress.total}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  log(`Done: inserted ${result.inserted}, skipped ${result.skipped}, failed ${result.failed}`);
  result.errors.forEach((e) => log("error: " + e));
  progress.state = "finished";
  window.demoImportResult = result;
}

document.getElementById("import").addEventListener("click", async (ev) => {
  ev.target.disabled = true;
  logEl.textContent = "";
  try {
    await run();
  } catch (err) {
    log("ABORTED: " + err.message);
    window.demoImportProgress.state = "aborted";
    window.demoImportResult = { aborted: true, error: err.message };
  } finally {
    ev.target.disabled = false;
  }
});
