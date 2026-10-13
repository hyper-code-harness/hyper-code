---
name: whatsapp
description: "Personal WhatsApp as a linked device (Baileys) — link by QR, mirror chats/contacts/messages into Postgres, read and search them, list group members, and send messages or join groups only with confirm: true."
---

# WhatsApp

The plugin connects to the user's WhatsApp account as a **linked device** (like WhatsApp Web) using Baileys.
The session (multi-file auth state) lives in `~/.hyper/whatsapp/auth`; it is never returned by functions.
Everything WhatsApp shares with the device (history sync on first link, then live events) is mirrored into the
Postgres schema `whatsapp` (`chats`, `contacts`, `messages`).

## Linking

1. `whatsapp.status({})` — `status: "open"` means linked; `"qr"`/`"loggedOut"` means linking is needed.
2. `whatsapp.login({})` → `{ qrPath, qrUrl }`. Show the image to the person, e.g. `<img src="{qrUrl}">` in
   respondHtml. They scan it in WhatsApp → Settings → Linked devices → Link a device.
3. QR rotates every ~20 s; call `login({})` again for a fresh one. Poll `status({ waitMs })` until `open`.
4. After linking, history sync fills the mirror over a minute or so.

## Read

- `whatsapp.chats({ query?, groups?, limit? })` — chats/groups, most recent first.
- `whatsapp.messages({ chat, limit?, query? })` — one chat, oldest→newest; `chat` = JID, phone or name fragment.
- `whatsapp.search({ query, limit? })` — text search across all chats.
- `whatsapp.participants({ chat })` — live group members with admin flags.

## Guarded writes

All writes require explicit user approval (ask with `input.request({ kind: "confirm" })`) and `confirm: true`:

- `whatsapp.send({ chat, text, confirm: true })`
- `whatsapp.joinGroup({ inviteLink, confirm: true })` — without `confirm` returns a preview (subject, size).
- `whatsapp.logout({ confirm: true })` — unlink this device.

`whatsapp.client` and `whatsapp.resolveChat` are internal helpers.
