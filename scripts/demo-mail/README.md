# Demo mail import

One-off page that fills the test mailbox (demouser82641@gmail.com) with sample emails from `emails.json`, using the
Gmail API `users.messages.insert`. Messages are stored directly in the mailbox; **nothing is ever sent or delivered**
(no `send` endpoints are used). It aborts unless the signed-in account matches the account field. Re-running is safe:
messages already present (matched by Message-ID) are skipped.

Usage:
1. Copy `import.html`, `import.js` and `emails.json` into `dist/demo-mail/`.
2. Open `chrome-extension://kbnlifhlkedlmebnkpjolokkjpbbihfh/demo-mail/import.html` in the dev Chrome.
3. Click Import and consent once (scopes `gmail.insert` + `gmail.readonly`).

Automation can poll `window.demoImportProgress` and `window.demoImportResult`.

Note: `npm run build` empties `dist/`, so the demo pages must be copied into `dist/demo-mail/` again after each build.
They are never part of a release build.

## Demo contacts

`contacts.html` / `contacts.js` save the fictional senders from `emails.json` as Google Contacts (name, email, generated
avatar photo) in the test account, using the People API (`people:createContact`, `updateContactPhoto`). Aborts unless the
signed-in account matches the account field. Re-running is safe: existing contacts are not duplicated and contacts that
already have a photo are not re-uploaded.

Usage: copy `contacts.html`, `contacts.js`, `avatars.js` and `emails.json` into `dist/demo-mail/`, open
`chrome-extension://kbnlifhlkedlmebnkpjolokkjpbbihfh/demo-mail/contacts.html`, click Create contacts and consent once
(scopes `contacts` + `gmail.readonly`). Poll `window.demoContactsProgress` / `window.demoContactsResult`.

## Reset

`reset.html` / `reset.js` undo what the import pages created in the test account, so a fresh import can be done. Copy
both into `dist/demo-mail/` and open `chrome-extension://kbnlifhlkedlmebnkpjolokkjpbbihfh/demo-mail/reset.html`. Aborts
unless the signed-in account matches the account field. Poll `window.demoResetProgress` / `window.demoResetResult`.

- **Trash demo mail**: lists all mailbox messages, reads only their Message-ID header, and moves those ending in
  `@demo-mail.example>` to Trash (`messages.trash`; never permanent deletion, `emails.json` is not consulted). Gmail empties
  Trash after 30 days. The import's skip check ignores trashed mail, so a re-import inserts fresh copies. Needs one extra
  consent (scope `gmail.modify`).
- **Delete demo contacts**: deletes only contacts whose biography is exactly `demo-mail sample contact` (one per second).
  Scopes `contacts` + `gmail.readonly`.

Recommended flow before taking screenshots: Trash demo mail -> Import (so the dates are relative to that day).
