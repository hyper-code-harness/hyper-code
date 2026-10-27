---
name: google
description: "Google account toolkit — one OAuth broker plus Gmail, Google Calendar, Docs/Drive, Sheets, Tasks and Workspace Admin Directory. Use when the user asks about reading or sending email, their calendar/events/meetings, Google Docs or Drive files, spreadsheets, to-do tasks, company users/groups/org chart. Keywords: gmail, email, inbox, send mail, drafts, labels, filters, unsubscribe, google calendar, gcal, events, meetings, invites, rsvp, free/busy, google docs, gdoc, google drive, google sheets, gsheets, spreadsheet, google tasks, gtasks, to-do, workspace admin, directory, company users, groups, org chart, oauth, google login."
---

# google

A container of Google APIs sharing **one unified OAuth token per account** (every scope granted at once), stored encrypted in local secrets (`secrets` namespace `google`, name `token:<account>`; the OAuth client and account list are bootstrapped once from 1Password `op://hyper/google/*`). Namespaces: **`google`** (token broker), **`gmail`**, **`gcal`** (Calendar), **`gdoc`** (Docs + Drive), **`gsheets`** (Sheets), **`gtasks`** (Tasks), **`gworkspace`** (Admin Directory). Every API namespace authenticates through `google.token`; the OAuth consent flow drives the user's live Chrome via `ctx.fns.browser.*`. Only route is a self-rendering `GET /google/SKILL.md`. All fns take an optional `account?` (falls back to `GOOGLE_ACCOUNT` env, or the sole authorized account).

## Functions

**google — auth broker**
- `google.accounts({})` — list authorized Google accounts (from the encrypted local secrets)
- `google.token({ account? })` — unified access token for all Google APIs; refreshes when expired, caches in state
- `google.reauth({ account })` — one OAuth flow granting every scope into a single token, auto-driving Chrome consent (WRITE: saves the token to encrypted local secrets)

**gmail — mail, labels, filters**
- `gmail.list({ query, max? })` — list messages by Gmail search query (metadata, batched)
- `gmail.get({ id })` — full message with decoded text body
- `gmail.send({ to, subject, body, cc?, bcc?, attachments?, threadId? })` — send plain-text email (WRITE)
- `gmail.reply({ threadId, to, subject, body })` — reply into a thread, prefixes `Re:` (WRITE)
- `gmail.draft({ to, subject, body })` / `gmail.drafts({ max? })` — create / list drafts
- `gmail.modify({ id, add?, remove? })` — add/remove labels (markRead = remove `UNREAD`, archive = remove `INBOX`, star…)
- `gmail.trash({ id, undo? })` — trash (or untrash) a message
- `gmail.labels({})` / `gmail.labelCreate({ name, hide? })` — list labels with counts / create a label (idempotent)
- `gmail.filters({})` / `gmail.filterCreate({ from?, to?, subject?, query?, archive?, markRead?, del?, star?, labelId? })` / `gmail.filterDelete({ id })` — server-side filters
- `gmail.unsubscribe({ from? | id?, apply? })` — unsubscribe via the `List-Unsubscribe` header (dry-run unless `apply:true`)
- `gmail.attachments({ id })` / `gmail.download({ id, attachmentId, path })` — list / save attachments

**gcal — calendar**
- `gcal.calendars({})` — list accessible calendars
- `gcal.events({ from?, to?, days?, q?, calendarId?, max? })` — list/search events in a time range
- `gcal.event({ id, calendarId? })` — get one event
- `gcal.freebusy({ from?, to?, days?, calendars? })` — busy intervals for one or more calendars
- `gcal.create({ summary, start, end, description?, location?, attendees? })` — create event (WRITE; start/end accept `14:00` / `2026-06-10` / `2026-06-10 14:00` / ISO)
- `gcal.update({ id, … })` — patch event fields (WRITE)
- `gcal.del({ id })` — delete event (WRITE)
- `gcal.rsvp({ id, status })` — set your response: `accepted` | `declined` | `tentative` (WRITE)

**gdoc — Docs + Drive**
- `gdoc.doc({ id })` — read a doc as plain text + Markdown (accepts bare id or URL)
- `gdoc.meta({ id })` — Drive file metadata for any file id (doc, sheet, pdf, folder…)
- `gdoc.search({ query, max?, docsOnly? })` — search Drive files (Docs only by default; raw Drive query supported)
- `gdoc.create({ title, content? })` — create a doc (WRITE)
- `gdoc.append({ id, text })` — append text to a doc (WRITE)
- `gdoc.upload({ path, name?, public? })` — upload a local file to Drive (WRITE)

**gsheets — spreadsheets**
- `gsheets.list({ query?, max? })` — list spreadsheets (most-recent first)
- `gsheets.info({ id })` — title + tabs with dimensions
- `gsheets.read({ id, range? })` — read cell values (A1 notation; default `A:Z`)
- `gsheets.write({ id, range, values })` — overwrite a range (WRITE)
- `gsheets.append({ id, range, values })` — append rows after the last row (WRITE)
- `gsheets.clear({ id, range })` — clear cell values, keep formatting (WRITE)
- `gsheets.create({ title, sheets? })` — create a spreadsheet with named tabs (WRITE)

**gtasks — Google Tasks** (`list` defaults to the first task list)
- `gtasks.lists({})` / `gtasks.tasks({ list?, completed?, hidden?, dueMin?, dueMax?, max? })` — list task lists / tasks
- `gtasks.get({ task, list? })` — one task
- `gtasks.add({ title, list?, notes?, due?, parent?, previous? })` — create task (WRITE)
- `gtasks.update({ task, title?, notes?, due?, status? })` — edit fields (WRITE)
- `gtasks.complete({ task, done? })` — mark done / reopen (WRITE)
- `gtasks.del({ task })` / `gtasks.move({ task, parent?, previous? })` / `gtasks.clear({ list? })` — delete / reorder / purge completed (WRITE)
- `gtasks.listAdd({ title })` / `gtasks.listUpdate({ list, title })` / `gtasks.listDel({ list })` — manage task lists (WRITE)

**gworkspace — Admin Directory** (needs a Workspace-admin account + `admin.directory.*` scopes)
- `gworkspace.users({ domain?, query?, max? })` — list/search directory users → `[{ email, name, title, phone, orgUnit, manager, suspended… }]`
- `gworkspace.user({ key })` — one user by email or id (title, department, manager, phones, aliases…)
- `gworkspace.groups({ domain? | userKey? })` — list groups (or the groups a user belongs to)
- `gworkspace.members({ group })` — members of a group

Each namespace also exposes a generic `<ns>.api({ path|url, method?, body?, account? })` escape hatch (`gmail.api`, `gcal.api`, `gdoc.api`, `gsheets.api`, `gtasks.api`, `gworkspace.api`) for raw calls not wrapped above.

## Routes

- `GET /google/SKILL.md` — renders this skill's own SKILL.md as HTML

## Call it

```sh
hyper repl 'await ctx.fns.google.accounts({})'
hyper repl 'await ctx.fns.gmail.list({ query: "is:unread", max: 5 })'
```

## Popular usage

Mined from real session history (most-used first). **Known accounts** (pass as `account:`; omit → first): `niquola@health-samurai.io`, `niquola@gmail.com`.

- `google.accounts({})` ·63 — list the connected Google accounts (start here if unsure which mailbox).
- `gmail.list({ query, max, account? })` ·60+ — search a mailbox; `query` is Gmail search syntax. Real queries used: `"is:unread"`, `"from:github.com newer_than:1d"`, `"(from:state.gov OR from:usvisa-info.com)"`.
- `gmail.get({ id, account })` ·45 — read one message in full (headers + body + parts).
- `gmail.api({ path, method?, body?, account? })` ·40+ — raw Gmail REST; common `path`: `"/labels"`, `"/profile"`, `"/settings/filters"`, `"/threads/<id>?format=full"`.
- `gmail.labels / filterCreate / unsubscribe / download / attachments / draft / reply / send` — labels, filters, one-click unsubscribe, save attachments, compose.

```sh
hyper repl 'await ctx.fns.gmail.list({ query: "is:unread", max: 10, account: "niquola@health-samurai.io" })'
hyper repl 'await ctx.fns.gmail.list({ query: "from:github.com newer_than:1d", max: 10 })'
hyper repl 'await ctx.fns.gmail.get({ id: "<messageId>", account: "niquola@gmail.com" })'
```
