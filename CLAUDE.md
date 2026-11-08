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

- `src/content.js` – content script on `mail.google.com`; loads InboxSDK, builds and mounts the side panel, talks to the
  background script. See "How the code fits together" below.
- `src/background.js` – service worker. Imports the SDK's `background.js` (injects `pageWorld.js`, needed on MV3) and
  also owns all Gmail API access (`chrome.identity` is unavailable to content scripts).
- `src/static/` – `manifest.json`, popup (`main.html` + `popup.js`, currently a placeholder), icon. Copied as-is to `dist/`.
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
  (width clamped, persisted in `localStorage`).
- The panel lists contact cards (a mail belongs to its sender; mail the user sent themself belongs to its To/Cc recipients; own address excluded), most recent mail first.
  Each card shows an avatar circle (the contact's Google photo, else their domain's logo, else a generic icon), the name, and the
  subject of that address's latest mail in gray.
- Contacts are loaded from the real Gmail data via the Gmail API in lazy batches (next batch when the panel is scrolled
  near the bottom, or while the list doesn't fill the panel).
- Cards are selectable (one at a time, click again to deselect). Selecting runs a real Gmail search
  `in:inbox (from:X OR (from:<me> (to:X OR cc:X)))` through the SDK router; deselecting returns to the inbox.

## How the code fits together

**Content script (`src/content.js`)** – top-level helpers plus `main()`:
- Pure/DOM helpers: panel creation (`createPanel`, `createResizeHandle`, `alignBottom`, `shiftClearOfMenu`), cards
  (`createCard`, `renderContacts`, `showLoadError`, `setupSelection`), `parseAddresses` (address-header parser).
- `main()` loads InboxSDK, then wires state and behaviour: `contacts` (Map address -> {address, name, subject}, insertion
  order = recency because pages arrive newest-first), `loadMore()` (paging), `onSelect()` (search/inbox navigation),
  `mount()`.
- **Mounting** is anchored on SDK-provided elements: a nav item's element (`NavMenu.addNavItem(...).getElement()`,
  inside the left menu) and a thread row's element (`Lists.registerThreadRowViewHandler`, inside the mail list). The
  panel is inserted before the child of their common ancestor that contains the list. Never replace this with Gmail
  class-name selectors.
- The panel is a flex-column wrapper: a scrolling list (`panel.list`) and the resize handle. The list holds the cards, then the loading spinner and the load-error row (`showLoadError`: message plus a neutral "Try again" button; while it's shown, scrolling doesn't retry), which `renderContacts` keeps last. With no cards, the spinner and error row are centered in the panel (CSS `:not(:has([data-address]))`). Render into `panel.list` only through `renderContacts`, so the handle, spinner and error row survive re-renders.
- Selection state is the module-level `selectedAddress`; selecting also fires a `chatmail:contactselect` DOM event on
  the panel (`detail.address`).

**Background (`src/background.js`)** – handles the message `chatmail:listInbox` `{ pageToken }` from the content
script and replies `{ ok, data | error }`. Every message from the content script carries `account` (the tab's Gmail
address, lowercased); the background rejects messages without it. Auth is per account: `chrome.identity.launchWebAuthFlow`
(OAuth implicit flow) with `login_hint` set to that account, silent first (`prompt=none`) and interactive only if needed.
Each token is verified (`users/me/profile` must return that account's address) before use or caching, and cached per
account in `chrome.storage.session` (`chatmail:token:<account>`). Gmail calls use `users/<account>`. It lists inbox
messages (`labelIds=INBOX`, 25 per page) and fetches each one with `format=metadata` (From/To/Cc/Subject/Date only),
returning `{ messages: [{subject, from, to, cc}], nextPageToken }`. A 401 drops the account's cached token and retries
once; other errors include Google's error message. It also handles `chatmail:countUnread` `{ addresses }` -> `{ address: count }`: one ids-only
`messages.list` with `q=in:inbox is:unread (from:X OR (from:<account> (to:X OR cc:X)))` and `maxResults=100` per address; the count is exact
up to 100 (a full page means "100 or more"), which the card badge shows as `99+`.
It also handles `chatmail:unreadChanges` `{ historyId }` -> `{ historyId, changes: [{delta, from, to, cc}] }`: one
`history.list` call (`labelId=UNREAD`, label added/removed) that the content script polls every 1 s (only while its tab is the visible one) to move the badges
by +1/-1 as mail is read or marked unread; without a `historyId` it just returns the current one as the baseline.

It also handles `chatmail:photos` `{ addresses }` -> `{ address: photoUrl }`: on first use it downloads the user's saved
contacts (`people/me/connections`) and people they've emailed (`otherContacts`) from the People API, builds an
address -> photo index in memory (skipping Google's default placeholder photos), and answers from it. Addresses are matched
locally, never sent anywhere; the photo URLs are `googleusercontent.com` images loaded directly by the content script.
Addresses without a photo fall back to their domain's favicon: `chatmail:favicons` `{ addresses }` -> `{ address: dataUrl }`
fetches `https://www.google.com/s2/favicons?domain=…` in the background script (then the parent domain; free-mail domains are
skipped; results cached per domain) and returns data URLs, so failed lookups don't log 404s in the Gmail console. Only domains
are sent, and only to Google. No non-Google avatar service is used on purpose (nothing about contacts may leave Google).

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
