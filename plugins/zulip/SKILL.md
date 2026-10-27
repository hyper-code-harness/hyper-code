---
name: zulip
description: "Live Zulip REST API client for configured instances — list channels, topics and users; read and search messages and DMs; optionally send, edit and mark messages read. Use for Zulip streams, channels, topics, direct messages, full-text search, chat.fhir.org and Health Samurai chat. Credentials stay in encrypted local secret storage."
---

# zulip

Live client over the Zulip REST API. It does not mirror messages into Postgres. Credentials live in Hyper's encrypted local secret storage (namespace `zulip`): one record per instance (`instance:<name>`, holding url, email and API key) plus the list of instance names (`instances`). To connect an account, open the form — `ctx.fns.input.request({ kind: "zulip-account", title: "Connect Zulip" })` — never ask for the key in chat. 1Password (vault `hyper`, items `zulip <instance>.json`) is only a one-time bootstrap when the local list is empty, or on `zulip.creds({ refresh: true })`.

The credentials never appear in function results. List the configured instances with `zulip.creds({})`; pass `instance` explicitly unless `ZULIP_INSTANCE` is set.

## Read functions

- `zulip.creds({ refresh? })` — configured instance names only; `refresh: true` re-reads them from 1Password.
- `zulip.channels({ instance? })` — channels/streams.
- `zulip.topics({ channel, instance? })` — topics in a channel.
- `zulip.messages({ channel?, topic?, sender?, mentions?, query?, unread?, limit?, instance? })` — read or full-text-search messages.
- `zulip.dms({ with?, group?, max?, fetch?, instance? })` — recent direct messages; `with` contains full/display names that must all occur in the conversation.
- `zulip.users({ channel?, instance? })` — organization members or channel subscribers.

## Write functions

These modify the real Zulip account. Do not call them without a clear user request:

- `zulip.send({ channel, topic, content, instance? })` — send a channel message.
- `zulip.edit({ id, content, instance? })` — edit a message posted by the account.
- `zulip.markRead({ channel?, instance? })` — clear unread flags, optionally in one channel.

`zulip.api` is the low-level escape hatch. Prefer the wrappers above and treat non-GET calls as writes.

## Examples

```ts
await ctx.fns.zulip.channels({ instance: "fhir" });
await ctx.fns.zulip.messages({
  channel: "implementers",
  topic: "US Core",
  instance: "fhir",
  limit: 30,
});
await ctx.fns.zulip.messages({ query: "FHIR R5", instance: "fhir" });
await ctx.fns.zulip.dms({ with: ["Josh Mandel"], group: false, instance: "fhir" });
```
