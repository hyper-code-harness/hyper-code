# Settings: declarations, instance files, database

One mechanism, three places a value can come from. Every key is **declared** once by the module that owns it;
the value for the whole instance lives in exactly **one** place, and you can always see which.

## 1. Declare a key — `$setting_<key>.ts` (code, owned by the module or plugin)

```ts
// src/nav/$setting_pages.ts          → key nav.pages
// ~/.hyper/user/hetzner/src/hetzner/$setting_projects.ts → key hetzner.projects
export default {
    type: "json",          // string | text | number | boolean | enum | json | secret
    default: undefined,    // value when nothing else sets it
    title: "Menu pages",
    description: "What it does, what values mean, where it is usually set.",
    // env?: "HYPER_X", options?: [...] (enum), min?/max? (number)
};
```

Core modules and plugins (official and user) declare keys the same way; the key is `<namespace>.<file name>`.
A plugin declares only its own namespace. Describe the meaning of the value in `description` — the settings
page and agents read it.

## 2. Fix a value for the instance — `$settings_<module>.json` (files of this instance)

```
~/.hyper/settings/                 # env HYPER_SETTINGS overrides the directory
  $settings_nav.json               # { "pages": ["search", "settings", "plugins"] }
  $settings_hetzner.json           # { "projects": [...] }
```

- One file per module, one directory per instance (atomic, exec, a laptop each have their own). It is
  configuration, not code: keep it out of plugin folders; it may be its own git repo or backup.
- Keys must be declared by a `$setting_` file; values are checked against the declared type. An undeclared key
  is a warning, a wrong type is an error; either way that key is ignored. `secret` keys are never accepted
  from files — use encrypted secret storage.
- Edits apply without a restart (the directory is re-checked at most once a second). A file with broken JSON
  keeps its last good values and reports an error. `ctx.fns.settings.files({ force: true })` shows the values,
  their file paths, errors and warnings.
- A value given by a file is **the** instance value: `settings.set` for that key at scope `global` throws
  ("fixed by <path>"), and the settings page (`/settings/declared`) shows it read-only with source `file: …`.
  To change it, edit the file; to hand it back to the UI, delete the key from the file.

## 3. Everything else — the database (UI, `settings.set`)

Resolution for `settings.get({ module, scopeType: "global", key })`:

1. instance file `~/.hyper/settings/$settings_<module>.json`
2. database row (set from the UI or `settings.set`)
3. `env` named in the declaration
4. declared `default`

Other scopes (`user`, `agent`, `provider`, …) are personal or per-object values in the database; instance files
do not touch them. A person's own value is read by the code that wants it (for example the person's menu
layout) and is a separate decision from the instance value.

## Examples

**Which pages the global menu (⌘/) shows and in what order** — `nav.pages`, a list of page ids. A page id is
the `<name>` of its `$app_<name>.json` (`src/$app_search.json` → `search`, `src/auth/$app_people.json` →
`people`). Not set: every core page by its declared order, administration pages folded. `[]`: none. Unknown
ids are skipped (a disabled plugin never breaks the list). Hiding a page does not block access to it.

```json
// ~/.hyper/settings/$settings_nav.json
{ "pages": ["search", "settings", "plugins", "people", "cron"] }
```

List the ids: `Object.keys(ctx.state.nav.apps)`.

**A plugin's own setting** — declare `~/.hyper/user/lisboalive/src/lisboalive/$setting_home.ts`, then fix it
for the instance in `~/.hyper/settings/$settings_lisboalive.json` as `{ "home": "Cascais" }`.

## Not yet in files

`nav.layout` (menu tabs and widgets) and `dock.layout` still keep their instance value in the database or env
(`HYPER_NAV`, `HYPER_DOCK`); moving them to files is a separate migration.
