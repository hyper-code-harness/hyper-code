# Users in chats — refactoring and migration plan

Status: draft for review. Scope decided in discussion (design §32–§34 plus the decisions below).

## Decisions

1. Every chat (agent session) has an **owner**: the user who created it.
2. **Subscription/credentials: always the Hyper owner's** (today's behavior). Personal subscriptions
   are deferred. The chat owner is recorded anyway, for "mine" and a later switch.
3. **Visibility: everyone sees every chat and can write in any.** Trusted team, no isolation.
4. Every human message carries its **author**. The UI draws the name with an avatar dot.
5. The LLM sees the author as a plain prefix: `<Name>: text`. No escaping, no tags — trusted setting.
6. The prefix is added only when the instance has **more than one active user**, so the single-user
   transcript stays byte-identical and prompt caches are not invalidated.
7. Derived chats (fork, delegated child, cron/wake/watch, external mail) get the owner of their
   parent chat, or of whoever created the trigger.

## Principles

- One code path; one user is just a case. No `if (multiuser)` beyond the prefix rule above.
- Additive, catalog-only migrations (nullable columns, new tables), `lock_timeout`, idempotent, exact
  `down`. No rewrite of large tables; backfill, if any, is separate, batched and optional.
- Old behavior until explicitly switched on. Code first (works with and without users), then data.
- Every step: own branch, rehearsal on a full DB copy (`script/multiuser.ts` pattern), rollback point.
- Tests never load user plugins (`src/$test.ts` isolation) — they must not touch live schemas.

## Steps

### Step 0 — hygiene
- Commit `src/$test.ts` (plugin isolation in tests) to `main`.
- Scheduled backup outside this machine.
- No migration.

### Step 1 — users and sign-in (done: branch `multiuser-users`, rehearsed)
- `users`; `agents.created_by`, `messages.author`, `events.actor` (nullable, catalog-only).
- Sign-in: 0 users = unchanged legacy behavior; 1 user = password only; 2+ = email + password.
- `script/multiuser.ts plan|backup|up|verify|down`; switch documented in `switch.md`.
- Existing history keeps NULL author; no backfill.

### Step 2 — author visible to the LLM and in the UI (no migration)
- `agent/buildLlmRequest`: for `role: "user"` messages with `author`, when active users > 1,
  send `"<" + users.name + ">: " + content`. Name resolved by id at request time (rename-safe).
  Structured content (images/documents): prefix the first text part.
- One line in the system prompt, only in the same condition: "Human messages start with `<Name>:`;
  answer the person who wrote. Your own replies have no prefix."
- `agent/renderEventHtml` (user event): name + deterministic colored initials from the user id.
  Shown only when users > 1 or the author differs from the chat owner.
- Rollback: revert code. Data unchanged.

### Step 3 — owner in lists, "mine / all" (no migration)
- `session.list({ owner?: string })` — filter by `created_by`; default in UI = current user.
- Nav: toggle "mine / all". Mobile API: same filter parameter, default all (clients unchanged).
- Owner of derived chats: verify `session.fork`, `agent.delegate`, `sharedAgent.delegate`, cron,
  wake, watch, external mail — each sets `createdBy` from the parent or the trigger's creator.
- Rollback: revert code.

### Step 4 — per-user read state and pins (small migration)
- Table `user_agent_state(user_id, agent_id, seen_at, seen_idx, pinned, PRIMARY KEY (user_id, agent_id))`.
- Code reads/writes it instead of `kv` keys `seen-at:<agent>`, `seen:<agent>`, `mobile-pin-agent:<agent>`
  (`session/list.ts`, `nav/next_unread`, `api/*_read_POST`, `api/*_pin_POST`, `nav/*_pin_POST`).
- Data: one-time copy of those `kv` keys into rows for the Hyper owner. Small (≈ number of agents).
  `kv` keys are **not deleted** in this step.
- Rollback: code reads `kv` again (still intact); drop the table.

### Step 5 — people management and "who am I" (no migration)
- Header: current user, sign out.
- Owner page: add user, disable, reset password, role. Second email (aliases) deferred.
- Usage attribution: `llm/recordUsage` also records the author/owner (key or column), so it is visible
  who spends the shared subscription.

### Step 6 — clients before the second person
- iPhone: email field when `/auth/session` returns `multiuser: true`. Must ship **before** a second
  user exists, otherwise phone sign-in breaks.
- Browser-extension bridge (`sidebar_pairs`): bind a pairing to a user.

### Step 7 — second person
Only after steps 2–6. Checklist: phone updated, `verify` shows `email + password`, the person knows
all chats are visible and the owner's subscription is used.

## Migration summary

| Step | Schema | Data | Rollback |
|---|---|---|---|
| 1 | `users`, 3 nullable author columns | create first user | `multiuser.ts down` |
| 2–3, 5 | none | none | revert code |
| 4 | `user_agent_state` | copy seen/pin from `kv` | code back to `kv`; drop table |

## Open questions

- Should the `<Name>:` prefix also go on messages from the chat owner, or only on others?
- For step 4, is a table better than per-user `kv` keys given `kv` is already the pattern?
- Anything in the current code that would break when two people write into the same chat concurrently
  (queue claim, `last_processed_msg_idx`, drain)?

---

## Review by Astra (codex:gpt-6-astra), read-only — verified against code

Verdict: **step 1 is not safe to switch on as currently documented.** The additive approach is sound;
the fixes below are required first. Each finding was checked against the code before accepting.

### Blockers for step 1 (fix before switching)

1. **Rollback order is wrong.** `switch.md` says to run `down` (drop `users` + columns) while the
   new code is running. The new code reads `users` on every request (`auth/currentUser`) and writes
   `created_by` in `session/save` → the running Hyper breaks, and a restart re-applies the migration.
   **Fix:** rollback = stop service → restore previous code → start. **Leave the additive schema in
   place** (old code ignores extra nullable columns and an unused table). `down` only as an optional
   cleanup, run with the old code already live.
2. **Unsafe git steps.** `git add -A` stages unrelated work; `git reset --hard HEAD~1` depends on the
   merge shape and can discard work. **Fix:** tag an explicit pre-cutover commit
   (`git tag pre-users`) and roll back with `git checkout pre-users -- .` / revert of the merge commit;
   never `reset --hard`. Commit your WIP selectively, not `-A`.
3. **Legacy session looks logged out.** Branch `auth/$route_session_GET` ignores `legacy=true` and
   returns 401 for a valid legacy cookie before the switch → clients calling `/auth/session` (iPhone)
   think they are signed out. **Fix:** return `authenticated: true` when `legacy` is true.
4. **The branch is not the build that will run.** Committed branch `session/save.ts` still writes
   `reflection`/`reflection_enabled` (5 references); the live schema and `main` WIP already dropped
   them. The rehearsal used the branch plus a temporary local patch. **Fix:** rebase onto the
   committed `main` (after step 0) and rehearse **that exact merged commit** on a disposable DB.
5. **Migration robustness.** `script/multiuser.ts` applies DDL and records `_migrations` separately;
   `IF NOT EXISTS` would silently accept an old, incompatible `users` table (exactly what happened
   once: the earlier version had NOT NULL email/password). `SET lock_timeout` is per pooled
   connection and may leak. **Fix:** before `up`, verify the shape of an existing `users` table
   (columns + nullability) and refuse on mismatch; run the migration on a reserved connection
   (`sql.reserve()`), `RESET` in `finally`.

### Changes to steps 2–6

- **Prefix all human messages, including the owner's** — otherwise unprefixed ones are ambiguous.
  Apply to a copy of the outgoing transcript, never stored messages; cover forked history and
  compacted context in `buildLlmRequest`; add a text part for image-only messages. Accept that
  renames/user-count changes alter prompt bytes and invalidate caches (rare).
- **Author must be set before rendering.** `appendUserMessage` renders `event.html` before
  `appendEvent` sets `actor` → the author badge would be missing. Resolve the actor first and put it on
  the event before `renderEventHtml`.
- **Derived chat owner:** `auth.actorId` prefers the requesting session user over the parent's
  creator, so a fork gets the requester, not the parent owner. Decide explicitly per path
  (fork/delegate → parent owner; new chat → requester) and pass the owner in, don't infer.
- **`createdBy ??=` on an old chat** assigns a creator in memory while `ON CONFLICT` keeps DB NULL →
  old chats stay ownerless and fall out of "mine". Treat NULL owner as "Hyper owner" in "mine", or
  backfill `agents.created_by` separately and optionally (agents only — 53k rows, batched).
- **Read state is also written in `ui/chatColumn.ts:22`** (web), not only mobile routes — include in
  step 4.
- **Step 4 rollback:** keeping `kv` keys does not preserve read/pin changes made after the switch.
  Dual-write the owner's state to `kv` during the rollback window, or accept the loss.
- **Usage attribution (step 5) is wrong as written:** `llm/recordUsage` stores **quota snapshots**,
  not per-request spend. Adding an author there says nothing about who spent tokens. **Deferred**:
  needs a real per-call usage log; not needed while the subscription is shared.

### Concurrency (two people in one chat)

Already safe at the queue level: atomic claim + run-token fencing (`workerLoop.ts:94–108`) and a
consumed-message frontier (`132–167`). Effect: messages from two people that arrive during one run
are answered together in one reply, not one reply each. Acceptable; the `<Name>:` prefix lets the
model address both. Needs a test for ordering and message/event consistency.

### Revised order

0. Hygiene: commit `src/$test.ts`, backup off-machine.
1. Fix blockers 1–5, rebase on committed `main`, rehearse the exact merged commit on a disposable DB,
   then switch.
2. Author in UI + LLM (prefix for everyone; actor before render).
3. Owner in lists, explicit owner for derived chats.
4. Per-user read state/pins incl. `ui/chatColumn`, dual-write to `kv` during rollback window.
5. People page + "who am I". (Usage attribution deferred.)
6. iPhone email field, sidebar pairing per user — before the second person.
7. Second person.

## Status after fixing the review (branch `multiuser-users`, 516628f)

All five step-1 blockers fixed and re-rehearsed on a fresh full copy of the live DB (110 migrations,
53 657 agents), on top of the real code (`main-wip-snapshot` = main + WIP):

1. Rollback is code-only; schema stays. Rehearsed: **old code on the migrated schema** signs in with
   the shared password, serves the API, saves and reloads chats. `down` is optional cleanup and
   refuses without `--old-code-running`.
2. `switch.md`: selective commit (no `add -A`), `git tag pre-users`, `merge --no-ff`, rollback via
   revert — no `reset --hard`.
3. `/auth/session` reports a legacy session as authenticated before the switch (rehearsed: 200).
4. Branch rebased onto the real code; `save.ts` uses the live column set. 82/82 tests.
5. Migration: one transaction on a reserved connection, `SET LOCAL lock_timeout`, converges an older
   `users` shape; `up` verifies the exact schema shape before creating anyone. Runs at boot in 24 ms
   on the copy and creates no user.

Steps 2–7 keep the review notes above.
