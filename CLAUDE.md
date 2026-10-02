# Chat Mail

Chrome extension (Manifest V3) that improves the Gmail UI.

## Hard rules

- **Client-only.** No backend, no server calls of our own. Everything runs in the browser.
- **Use InboxSDK (`@inboxsdk/core`) to interact with the Gmail UI.** Do not locate Gmail elements by arbitrary
  ids/class names/selectors (Gmail's are obfuscated and change). Get anchor elements from SDK APIs
  (e.g. `NavMenu.addNavItem(...).getElement()`, `ThreadRowView.getElement()`, router/route handlers) and derive
  placement structurally from them. Only fall back to raw DOM work for things the SDK has no API for, and keep it
  relative to SDK-provided elements.

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
- The panel lists contact cards (senders and addressees of inbox mail, own address excluded), most recent mail first.
  Each card shows an avatar circle, the name, and the subject of that address's latest mail in gray.
- Contacts are loaded from the real Gmail data via the Gmail API in lazy batches (next batch when the panel is scrolled
  near the bottom, or while the list doesn't fill the panel).
- Cards are selectable (one at a time, click again to deselect). Selecting runs a real Gmail search
  `in:inbox (from:X OR to:X OR cc:X)` through the SDK router; deselecting returns to the inbox.

## How the code fits together

**Content script (`src/content.js`)** – top-level helpers plus `main()`:
- Pure/DOM helpers: panel creation (`createPanel`, `createResizeHandle`, `alignBottom`, `shiftClearOfMenu`), cards
  (`createCard`, `renderContacts`, `showStatus`, `setupSelection`), `parseAddresses` (address-header parser).
- `main()` loads InboxSDK, then wires state and behaviour: `contacts` (Map address -> {address, name, subject}, insertion
  order = recency because pages arrive newest-first), `loadMore()` (paging), `onSelect()` (search/inbox navigation),
  `mount()`.
- **Mounting** is anchored on SDK-provided elements: a nav item's element (`NavMenu.addNavItem(...).getElement()`,
  inside the left menu) and a thread row's element (`Lists.registerThreadRowViewHandler`, inside the mail list). The
  panel is inserted before the child of their common ancestor that contains the list. Never replace this with Gmail
  class-name selectors.
- The panel is a flex-column wrapper: a status line, a scrolling list (`panel.list`, holds the cards), and the resize
  handle. Render into `panel.list` only, so the handle/status survive re-renders.
- Selection state is the module-level `selectedAddress`; selecting also fires a `chatmail:contactselect` DOM event on
  the panel (`detail.address`).

**Background (`src/background.js`)** – handles the message `chatmail:listInbox` `{ pageToken }` from the content
script and replies `{ ok, data | error }`. It gets a token via `chrome.identity.getAuthToken`, lists inbox messages
(`labelIds=INBOX`, 25 per page) and fetches each one with `format=metadata` (From/To/Cc/Subject/Date only), returning
`{ messages: [{subject, from, to, cc}], nextPageToken }`. A 401 refreshes the token once; other errors include Google's
error message. It also handles `chatmail:countUnread` `{ addresses }` -> `{ address: count }`: one ids-only
`messages.list` with `q=in:inbox is:unread (from:X OR to:X OR cc:X)` and `maxResults=100` per address; the count is exact
up to 100 (a full page means "100 or more"), which the card badge shows as `99+`.

**Gmail API / auth constraints** – uses the restricted scope `gmail.readonly` (needed for the `q` search parameter, which
`gmail.metadata` forbids; it also allows reading bodies, but the code only reads headers and ids). `q` is used only for
the unread counts; opening a contact's mail is done through Gmail's own search UI via the SDK router. The manifest carries `key` (stable extension id), `oauth2.client_id` and `oauth2.scopes`,
`identity` permission and the `https://gmail.googleapis.com/` host permission; the client id/key were created manually
in Google Cloud and must not be changed or regenerated by agents. The Gmail API must be enabled in that Cloud project.

**Messaging convention** – internal names (message types, events, storage keys) use the `chatmail:` prefix.

## Working conventions

- **Simplify rather than patch:** when fixing a bug, look for the root cause and prefer restructuring/simplifying the
  code so the bug can't happen, instead of layering more special cases, guards or timeouts on top of existing code.

- **Commit messages:** concise, clear, one-line description of what changed. No `Co-Authored-By` or other Claude attribution lines.
- **Always build after changes:** after any change that requires `npm run build` to take effect (anything under `src/`, `build.mjs`, or dependencies), run it yourself; don't leave it for the user.
- **Never push:** do not run `git push` (or otherwise publish commits to a remote). Committing locally is fine; pushing is left to the user.
