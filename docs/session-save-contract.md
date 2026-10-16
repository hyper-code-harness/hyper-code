# session.save: state only

`session.save({ agent })` creates or updates the `agents` row: settings, ownership on first creation, parent/fork metadata, sleep context, and durable scratchpad (including plans). It does **not** import, replace, delete, or refresh messages/events. This is an intentional contract change: passing populated `agent.messages` / `agent.events` no longer persists those arrays.

History is database-owned. Append new rows through `session.appendMessage` / `session.appendEvent` (or their typed wrappers); update existing rows through the specific update APIs. Explicit imports/copies may call `session.replaceMessages` / `session.replaceEvents` after creating the destination agent. These replacement operations are intentional destructive replacements, not a routine accompaniment to save. Read with `session.load`, or refresh a live object with `session.syncAgentState`.

Forks retain their own-row/inherited-prefix boundary: `getMessages` reads own rows, `getFullMessages` and a synchronized live fork include inherited rows. Never import a fork's full inherited view into its own rows. Save does not inspect either view; the runtime-only inheritedMessageCount marker is therefore unnecessary and removed.

Stale saves cannot remove concurrently appended history or rewrite row identifiers, timestamps, authors, exclusion flags, provider state, request IDs, or result references. The state upsert still uses the existing last-writer-wins scratchpad/settings contract; this change does not introduce state CAS or claim general lost-update protection.

Production callers audited: agent.start, session.fork, agent.delegateTask, agent.updateGoalSidecar, knowledge.updateSidecar, ui.createAgent, project-local calendar.prepareToday and calendar.wakeMaster. They require state persistence only. No private-plugin save callers or production import/export save pipeline were found. ui.createAgent's initial/error trace events now use explicit appendEvent + sync instead of mutating its runtime event array.

Tests run against the isolated test Postgres (the existing mkTestCtx harness), including a barrier after the real agents upsert so another durable append completes before save returns, concurrent saves/appends, full raw-row equality, explicit import/copy, and synchronized forks. No live migration or database reset is needed. Reload session.save, session.syncAgentState, session.appendEvent and ui.createAgent together after review, and validate their runtime docs/types; the Agent type marker removal requires no schema migration.
