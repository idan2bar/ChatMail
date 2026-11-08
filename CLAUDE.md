# Chat Mail

Chrome extension (Manifest V3) that improves the Gmail UI.

## Hard rules

- **Client-only.** No backend, no server calls of our own. Everything runs in the browser.
- **Use InboxSDK (`@inboxsdk/core`) to interact with the Gmail UI.** Do not locate Gmail elements by arbitrary
  ids/class names/selectors (Gmail's are obfuscated and change). Get anchor elements from SDK APIs
  (e.g. `NavMenu.addNavItem(...).getElement()`, `ThreadRowView.getElement()`, router/route handlers) and derive
  placement structurally from them. Only fall back to raw DOM work for things the SDK has no API for, and keep it
  relative to SDK-provided elements.
- **All data is per Gmail account.** Every background request and every cache/storage key holding mail-derived data must
  be bound to the tab's account; never use the Chrome profile's default account.

## Layout

- `src/content.js` – content script entry on `mail.google.com`; `main()` loads InboxSDK, owns the state (contacts,
  selection, unread counts, photos, polling) and mounts the side panel. Does nothing if the popup switch is off
  (`chatmail:enabled === false` in `chrome.storage.local`). See "How the code fits together" below.
- `src/content/` – modules used by `content.js`:
  - `storage.js` – persistence: panel width and open state (`localStorage`), selected contact (`sessionStorage`).
  - `panel.js` – panel element (scrolling list, spinner, load-error row, resize handle), nav-menu toggle button, `showLoadError`.
  - `cards.js` – contact cards and avatars: `renderContacts`, `setupSelection`, per-page card/avatar caches.
  - `layout.js` – Gmail layout integration: `findLayout`, `alignBottom`, `shiftClearOfMenu`, `watchContactRow`.
  - `addresses.js` – `parseAddresses` (address-header parser), `mailOwners` (which contacts a mail is credited to).
  - `messaging.js` – `createAskBackground` (account-scoped requests to the background script).
- `src/background.js` – service worker. Imports the SDK's `background.js` (injects `pageWorld.js`, needed on MV3) and
  also owns all Google API access (`chrome.identity` is unavailable to content scripts). It also drives the toolbar icon:
  on Gmail tabs the icon opens the popup (set per tab via `action.setPopup`, restored on startup/reload); on any other
  tab a click focuses an open Gmail tab (and its window), else opens Gmail.
- `src/static/` – `manifest.json`, popup (`main.html` + `popup.js`), icon. Copied as-is to `dist/`. The popup has an
  on/off switch (`chatmail:enabled` in `chrome.storage.local`, on unless `false`); changing it sets
  `chatmail:refreshPending`, which shows a "Refresh Gmail" note/button in the popup. The content script clears the flag
  on load, since loading Gmail applies the setting.
- `build.mjs` – esbuild bundling into `dist/` (also copies the SDK's `pageWorld.js` to `dist/` root).
- `dist/` – build output; **this is the folder to load unpacked** in `chrome://extensions`. Gitignored.

There is no test suite; verify by building, reloading the extension and the Gmail tab, and checking the panel and the
DevTools console (errors are prefixed `[ChatMail]`).

## Testing in Chrome (dev instance)

Develop and test in a **dedicated Chrome instance**, never the user's real Chrome profiles. It uses its own user-data
folder `.chrome-dev/` (gitignored, signed in to the demo Gmail account) and remote debugging on port 9222.

- Start it with `powershell -NoProfile -File scripts/dev-chrome.ps1` (check first with
  `curl -s http://127.0.0.1:9222/json/version`; skip if it already answers).
- `.mcp.json` points the `chrome-devtools` MCP at it (`--browserUrl=http://127.0.0.1:9222`). Don't switch it back to
  `--autoConnect` and don't enable remote debugging in the user's real Chrome.
- Loop: edit -> `npm run build` -> `mcp__chrome-devtools__list_extensions` (get the id; if the extension isn't listed,
  `install_extension` with `C:\Projects\BetterGmail\dist`) -> `reload_extension` -> reload the Gmail tab
  (`navigate_page` type reload) -> check `list_console_messages` for `[ChatMail]` errors and `take_screenshot`.
- If the MCP can't connect, the dev Chrome isn't running: start it with the script above.
- First sign-in to Gmail and the first OAuth consent in that profile are done by the user, not by you.

## Workflow

```
npm install
npm run build     # or: npm run watch
```

Then load `dist/` as an unpacked extension and reload the Gmail tab. Reload the extension after each rebuild.

InboxSDK needs an app id: replace `APP_ID` in `src/content.js` with one registered at https://www.inboxsdk.com/register.

## Current features

- Vertical side panel inserted between the left main menu and the mail list's white area (outside the inbox tabs),
  stretching to fill the available height. It scrolls vertically and is resizable by dragging its right edge
  (width clamped, persisted in `localStorage`). A button in the left nav menu (an SDK nav item whose own markup is
  hidden) opens/closes the panel; the state is persisted in `localStorage` `chatmail:panelOpen` (open by default).
- The panel lists contact cards (a mail belongs to its sender; mail the user sent themself belongs to its To/Cc recipients; own address excluded), most recent mail first.
  Each card shows an avatar circle (the contact's Google photo, else their domain's logo, else a generic icon), the name, and the
  subject of that address's latest mail in gray.
- Contacts are loaded from the real Gmail data via the Gmail API in lazy batches (next batch when the panel is scrolled
  near the bottom, or while the list doesn't fill the panel).
- Cards are selectable (one at a time, click again to deselect). Selecting runs a real Gmail search
  `in:inbox (from:X OR (from:<me> (to:X OR cc:X)))` through the SDK router; deselecting returns to the inbox. Navigating elsewhere
  (any other search or route) clears the selection.
- The selected contact is persisted per tab and account in `sessionStorage`, so it survives a reload of the tab.
- While a contact is selected, Gmail's own contact card and search filter chips above the results are hidden, and the
  search box shows the contact's name instead of the raw query (replaced only while the box holds exactly that query,
  so text the user types is never overwritten).
- Cards show an unread badge (exact count, `99+` from 100): blue when the contact's latest mail is unread, gray otherwise.
- The list updates live: new or moved mail re-orders contacts and updates their latest subject; read/unread changes update
  badges.

## How the code fits together

**Content script (`src/content.js` + `src/content/`)** – `main()` loads InboxSDK, then wires state and behaviour; the
modules in `src/content/` hold the pure/DOM helpers (see Layout). No module-level state except the per-page card/avatar
caches in `cards.js`.
- State in `main()`: `contacts` (Map address -> {address, name, subject, latestId, latestUnread}, insertion order =
  recency because pages arrive newest-first), `unreadCounts`, photo/logo maps, and the selection (`selectedAddress`,
  `expectedQuery`, `selectedName`). `loadMore()` pages the inbox, `mergeLatestPage()` merges a re-fetched first page,
  `refresh()` re-renders, `toggleContact()`/`onSelect()` do the search/inbox navigation, `setSearchBoxText()` swaps the
  search box text, `mount()` mounts the panel. `sdk.Router.handleAllRoutes` re-runs `mount()` and clears the selection when
  the route is not our search (or a thread opened from it); "ours" is recognized by the query's content, not by a flag.
- **Mounting** is derived from the SDK nav item alone (`NavMenu.addNavItem(...).getElement()`), so it works on pages
  without mail rows. `findLayout(navEl)`: the first ancestor of the nav item whose parent is a row-direction flex container
  is the menu column; its next sibling is the main area (InboxSDK relies on that too). The panel is placed after the main
  area in the DOM and moved visually between menu and main area with flex `order`. Never replace this with Gmail
  class-name selectors.
- `mount()` is idempotent: it is called when the nav item appears and re-checked on every route change, and does work only
  when there is no connected panel for the current layout. Each mount has an `AbortController`; aborting it tears down the
  panel, observers, listeners, the style element and the markers/`order` styles it added.
- The panel is a flex-column wrapper: a scrolling list (`panel.list`) and the resize handle. The list holds the cards,
  then the loading spinner and the load-error row (`showLoadError`: message plus a neutral "Try again" button; while it's
  shown, scrolling doesn't retry), which `renderContacts` keeps last. With no cards, the spinner and error row are centered
  in the panel (CSS `:not(:has([data-address]))`). Render into `panel.list` only (`renderContacts`), so the handle, spinner
  and error row survive re-renders. Selecting also fires a `chatmail:contactselect` DOM event on the panel
  (`detail.address`).
- `watchContactRow` hides Gmail's contact card and filter chips for the selected contact (found by content inside the
  SDK-anchored container, styled via marker attributes). Scans are coalesced to one per animation frame, and it idles
  when nothing is selected and nothing is marked.
- Live updates: `pollMailboxChanges` calls `chatmail:mailboxChanges` every 1 s, only while the tab is visible (and once
  on becoming visible). Counts are never adjusted by +-1; they are re-requested exactly via `chatmail:countUnread` for the
  affected contacts (all loaded contacts on `recountAll`). `inboxChanged` refetches the first inbox page and merges it.
  The history id only advances after a poll fully succeeded.

**Background (`src/background.js`)** – handles messages from the content script and replies `{ ok, data | error }`. Every
message carries `account` (the tab's Gmail address, lowercased); the background rejects messages without it. Auth is per
account: `chrome.identity.launchWebAuthFlow`
(OAuth implicit flow) with `login_hint` set to that account, silent first (`prompt=none`) and interactive only if needed.
Each token is verified (`users/me/profile` must return that account's address) before use or caching, and cached per
account in `chrome.storage.session` (`chatmail:token:<account>`). Gmail calls use `users/<account>`. All Google requests go
through one limiter (at most 10 in flight) and 429/5xx/rate-limit 403 responses are retried with backoff (`Retry-After`
honoured, capped at 10 s). A 401 drops the account's cached token and retries once; other errors include Google's error
message.
- `chatmail:listInbox` `{ pageToken }` -> `{ messages: [{id, unread, subject, from, to, cc}], nextPageToken }`: lists inbox
  messages (`labelIds=INBOX`, 25 per page) and fetches each with `format=metadata` (From/To/Cc/Subject/Date only).
- `chatmail:countUnread` `{ addresses }` -> `{ address: count }`: one ids-only `messages.list` with
  `q=in:inbox is:unread (from:X OR (from:<account> (to:X OR cc:X)))` and `maxResults=100` per address; the count is exact up to 100 (a full
  page means "100 or more"), which the card badge shows as `99+`.
- `chatmail:mailboxChanges` `{ historyId }` -> `{ historyId, inboxChanged, recountAll, messages: [{id, unread, from, to, cc}] }`:
  reads the mailbox change log (`history.list`; inbox mail added/deleted, INBOX/UNREAD label changes) and returns the
  current state of the affected inbox messages. `inboxChanged`: the inbox contents may have changed (refetch the first
  page); `recountAll`: some change couldn't be attributed to addresses (deleted/vanished message, history too old).
  Without a `historyId` it just returns the current one as the baseline.
- `chatmail:photos` `{ addresses }` -> `{ address: photoUrl }`: on first use it downloads the user's saved
  contacts (`people/me/connections`) and people they've emailed (`otherContacts`) from the People API, builds an
  address -> photo index in memory (skipping Google's default placeholder photos), and answers from it. Addresses are matched
  locally, never sent anywhere; the photo URLs are `googleusercontent.com` images loaded directly by the content script.
- `chatmail:favicons` `{ addresses }` -> `{ address: dataUrl }`: addresses without a photo fall back to their domain's favicon,
  fetched from `https://www.google.com/s2/favicons?domain=…` in the background script (then the parent domain; free-mail
  domains are skipped; results cached per domain) and returned as data URLs, so failed lookups don't log 404s in the Gmail
  console. Only domains are sent, and only to Google. No non-Google avatar service is used on purpose (nothing about
  contacts may leave Google).

**Gmail API / auth constraints** – uses the restricted scope `gmail.readonly` (needed for the `q` search parameter, which
`gmail.metadata` forbids; it also allows reading bodies, but the code only reads headers and ids). `q` is used only for
the unread counts; opening a contact's mail is done through Gmail's own search UI via the SDK router. Photos additionally need the scopes `contacts.readonly` and `contacts.other.readonly` and the People API enabled in the
Cloud project (users re-consent once). The manifest carries `key` (stable extension id), the `identity` permission and the
`https://gmail.googleapis.com/` host permission. The Web OAuth client id lives in `OAUTH_CLIENT_ID` at the top of
`background.js` (redirect URI `https://<extension-id>.chromiumapp.org/`). The client id/key were created manually in
Google Cloud and must not be changed or regenerated by agents. The Gmail API must be enabled in that Cloud project.

**Messaging convention** – internal names (message types, events, storage keys) use the `chatmail:` prefix.

## Working conventions

- **Simplify rather than patch:** when fixing a bug, look for the root cause and prefer restructuring/simplifying the
  code so the bug can't happen, instead of layering more special cases, guards or timeouts on top of existing code.

- **Commit messages:** concise, clear, one-line description of what changed. No `Co-Authored-By` or other Claude attribution lines.
- **Always build after changes:** after any change that requires `npm run build` to take effect (anything under `src/`, `build.mjs`, or dependencies), run it yourself; don't leave it for the user.
- **Never push:** do not run `git push` (or otherwise publish commits to a remote). Committing locally is fine; pushing is left to the user.
