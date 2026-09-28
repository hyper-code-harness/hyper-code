# Switching the live Hyper to users

Branch `multiuser-users`, built **on top of your real code**: base commit `main-wip-snapshot`
(= `main` + your uncommitted changes in `src/ plugins/ script/ docs/`, a local branch, never pushed).
Rehearsed on a full copy of the live database, including running the **old** code on the migrated
schema.

What changes for you: only step 5. Steps 1–4 keep sign-in exactly as today.

Hyper runs as launchd service `com.niquola.hyper` (dir `~/hyper-code2`, KeepAlive).
Restart: `launchctl kickstart -k gui/$(id -u)/com.niquola.hyper`.

---

## 1. Commit your work on `main` — selectively

Do **not** use `git add -A`: the tree has ~100 unrelated files (screenshots in `.hyper/`, `doonto/`
artifacts). Commit what you mean to keep:

```bash
cd ~/hyper-code2
git add -u src plugins script docs package.json            # tracked changes
git add src/agent/'$migration_'*.ts                         # your new migrations
git status --short                                          # review before committing
git commit -m "WIP before users"
```

`src/$test.ts` must be in this commit: it keeps tests from loading plugins, whose migrations write to
live schemas.

## 2. Mark the rollback point

```bash
git tag pre-users            # the exact code you will return to on rollback
```

## 3. Merge

```bash
git merge --no-ff multiuser-users
```

The branch was built on a snapshot of your WIP. If your commit in step 1 differs (you committed
something else), git shows a conflict — most likely in `src/$middleware.ts` or
`src/session/save.ts`. Keep your lines and add ours; the branch versions show the intended result.

Check (tests do not load plugins):
```bash
bun test src/auth src/session          # expected: 82 pass, 0 fail
```

## 4. Backup and restart with the new code — sign-in does NOT change yet

```bash
bun script/multiuser.ts backup
launchctl kickstart -k gui/$(id -u)/com.niquola.hyper
```

On start the migration runs automatically: it adds the `users` table and three empty author columns
in one transaction (takes < 1 s, gives up after 3 s of waiting for a lock and retries on the next
start). **It creates no user.** With no users, sign-in is the old shared password, `/auth/session`
still reports you as signed in, `/auth/setup` is closed for this install.

Check: Hyper opens, you are signed in, the phone still works.

```bash
bun script/multiuser.ts verify        # expected here: problems = ["no active user"], everything else ok
```

## 5. Switch — the only step that changes sign-in

Look first (read-only):
```bash
bun script/multiuser.ts plan --name "Nikolai Ryzhikov" --email niquola@health-samurai.io
```
Expect: database `.../hyper`, migration "already applied", "create first user Nikolai Ryzhikov …
password = current shared password".

Then (the `--db hyper` must match the connected database — guards against confusing it with a copy):
```bash
bun script/multiuser.ts up --db hyper --name "Nikolai Ryzhikov" --email niquola@health-samurai.io
bun script/multiuser.ts verify
```
`verify` must show `"ok": true`, `"signIn": "password only…"`, `"doonto": "ok"`. `up` checks the exact
shape of the `users` table first and refuses on any mismatch.

After this:
- You are user `niquola`, owner. Same password.
- **All open sessions are signed out** (browser, phone) — sign in again with the same password. The
  phone needs no email while you are the only user.
- New chats, messages and events are recorded as yours. Old history has no author.

## 6. Check

- Browser: sign in with your password, Hyper opens, `/auth/session` shows `Nikolai Ryzhikov`.
- Phone: sign in with the same password.
- Create a chat, write a message → `created_by = 'niquola'`.

---

## Rollback

**Code only. Leave the database as it is.**

```bash
cd ~/hyper-code2
git revert -m 1 --no-edit HEAD          # if the merge is the last commit; otherwise:
# git checkout pre-users -- src script  # and commit
launchctl kickstart -k gui/$(id -u)/com.niquola.hyper
```

The old code ignores the `users` table and the extra nullable columns (rehearsed: old code signs in
with the shared password and saves chats normally on the migrated schema). Everything is as before
the switch; the shared password works again.

Do **not** drop the schema while the new code is running — it reads `users` on every request, and
the next start would re-create it. Optional cleanup, only after the old code is live:
```bash
bun script/multiuser.ts down --db hyper --yes --old-code-running
```

Last resort — full dump from before the change (stop Hyper first; everything after the dump is lost):
```bash
pg_restore --clean --if-exists --no-owner -d postgres://hyper:hyper@localhost:54393/hyper \
  ~/hyper-backups/hyper-full-2026-09-25-before-users.dump
```

---

## Afterwards

- Drop the rehearsal copy: `psql postgres://hyper:hyper@localhost:54393/postgres -c "DROP DATABASE hyper_rehearsal"`.
- Delete `/tmp/hyper_full.dump`; delete branch `main-wip-snapshot`.
- `git worktree remove ~/hyper-code2-users`.
- Second email (`<personal email>`) is not supported yet (one email per user) — plan step 5.
