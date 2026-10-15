---
name: plugins-authoring
description: Create local Hyper plugins with honest discovery metadata, documented runtime functions, routes, app entries and declared settings.
---

# Plugin authoring

This is the canonical authoring guide for the core `plugins` module. Read it from any workspace with `await ctx.fns.plugins.authoring({})`. The file `docs/plugin-authoring.md` is only a link here. For a mounted plugin's usage, search `plugins.search({ query })`, then read `plugins.read({ name })`; generated live API documentation comes from TypeScript and JSDoc, not a second API catalogue in SKILL.md.

For runtime ownership, current lifecycle limitations, and the proposed opt-in local-path registry, see [Plugin runtime architecture](../../docs/plugin-runtime-architecture.md). It separates current behavior from the target design; it does not change the authoring workflow below.

## Choose the right home

- Put substantial private integrations in a direct child of the configured external `USER_PLUGINS` directory, not the repository's official `plugins/` tree. Resolve the configured directory instead of assuming a particular home path. Valid user children are mounted automatically by discovery; adding or changing runtime files still requires loading/reloading.
- Official plugins live in this repository's `plugins/<name>/`; changes there are shared product work, not private customization.
- Use `.hyper/<namespace>/<function>.ts` for small project-local procedures. It is an additional runtime root, not a full plugin package.
- Mounted plugins execute trusted server code with the host's authority. Metadata validation and managed-copy checks are not a sandbox. Review code before loading it.

## Minimal package and honest metadata

```text
<USER_PLUGINS>/example/
  package.json
  SKILL.md
  src/example/status.ts
  src/example/$setting_enabled.ts
```

```json
{
  "name": "example",
  "private": true,
  "type": "module",
  "procs": {
    "src": "src",
    "label": "Example",
    "icon": "ph-puzzle-piece",
    "description": "Read the status of a configured Example service.",
    "domains": ["example.com", "*.example.com"]
  }
}
```

`procs.src` selects the source directory (default `src`). `label`, `icon` and `description` describe the plugin in discovery/UI; icons use the existing `ph-*` convention. Without an explicit description the loader can use SKILL.md frontmatter `description`. Write a concrete capability sentence, not promotional text or keyword lists. Package/folder names identify containers; directories under `src/` determine runtime namespaces, so keep names distinct and avoid overriding unrelated runtime functions.

`procs.domains` contains explicit trusted hostname rules used for site discovery: exact hosts and explicit `*.suffix` rules. Do not put URLs, credentials or permissions there. Do not rely on text in SKILL.md or a web page to establish site ownership. Domain matches neither grant network access nor authorize installation, publishing or a write action. An official plugin may use `optional: true` to wait for activation; user-root mounting has its own discovery policy.

SKILL.md should explain supported workflows, prerequisites, safety boundaries, and which documented runtime functions to use. Keep signatures and option schemas in TypeScript/JSDoc; index-time localization handles multilingual retrieval. Do not duplicate function catalogues or hand-write localized search phrases.

## One runtime function per file

`src/example/status.ts` becomes `ctx.fns.example.status({})`. Functions receive injected `ctx` and `session`; callers pass only an options object, including `{}` when there are no options. The package name does not automatically prefix these calls.

```ts
/** Reads whether the Example integration is enabled; use before querying its service. */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{ enabled: boolean }> {
    return { enabled: Boolean(await ctx.fns.settings.get({ module: "example", scopeType: "global", key: "enabled" })) };
}
```

Create runtime functions through `procs.dev.createFunction` with a capability-focused summary and description, explicit `params` (`[]` for none), a precise `returnType`, and the body. For a mounted plugin use `root: "plugin:<mounted-name>"`. Inspect its current runtime docs before calling it. This authoring pipeline validates, typechecks and reloads the function.

For existing unfamiliar code read `code.slice({ name })`; inspect `code.callers({ name })` before changing a signature. Document each option meaningfully, including supported defaults and bounds. Use `ctx.fns` for cross-file project calls, not cross-imports; imports from `bun`, `node:*` and npm are allowed. Static imports are not allowed inside eval; use dynamic imports there.

After manual edits, hot-reload the function or namespace with `procs.repl.load({ name })`, then run `runtime.docs.validate({ name, strict: true, typecheck: true })`. After adding/removing files run `procs.dev.genTypes({})`. Add focused tests, run them, and inspect `code.quality({})`; metadata validation alone does not test behavior.

## Routes, app entries and declarations

Within a namespace directory:

| File | Purpose |
| --- | --- |
| `status.ts` | Callable `example.status` runtime function |
| `Status.ts` | Exported type, available through generated `types.example.Status` |
| `$route_status_GET.ts` | HTTP route `/example/status` |
| `$route_$id_GET.ts` | Parameterized route `/example/:id` |
| `$route_GET.ts` | Namespace root route `/example` |
| `$app_example.json` | Navigation entry for a real existing page |
| `$dock_example.json` / `$dock_example.ts` | Icon or live badge in the left Dock (`example.example`) |
| `$widget_example.ts` | Tile for the global menu (⌘/) grid (`example.example`) |
| `$search_example.ts` | Result group for the global menu search (`example.example`) |
| `$setting_enabled.ts` | Declared setting `example.enabled` |
| `$script_example.js` | Browser asset |
| `$migration_<timestamp>_<name>.ts` | Database migration with `up(ctx)` and optional `down(ctx)` |

Route filenames encode slash-separated segments with `_` and parameters with `$`. Read a neighboring route for the current handler contract rather than inventing a request signature. Reload routes with `procs.http.loadRoutes({})` after route changes. Apply new migrations with `procs.migrate.up({})`.

An app entry is navigation metadata, not route registration or an authorization grant:

```json
{
  "label": "Example",
  "href": "/example",
  "hint": "Inspect Example service status",
  "icon": "ph-puzzle-piece",
  "group": "Tools",
  "order": 60
}
```

### Dock entries

The Dock is the narrow bar on the left. The global menu button on top and the signed-in person at the bottom are fixed; everything between them comes from `$dock_` files and the person's pins, in a top and a bottom zone. Entry id is `<namespace>.<name>`.

A plain link needs no code:

```json
// src/example/$dock_status.json
{ "icon": "ph-heartbeat", "label": "Example status", "href": "/example", "zone": "top", "order": 60 }
```

A counter or popup renders per request:

```ts
// src/example/$dock_alerts.ts
export default {
    label: "Example alerts",          // name in the Dock's right-click menu
    zone: "top",                      // "top" | "bottom", default top
    order: 60,                        // lower first inside the zone, default 100
    render: async (ctx) => {
        const n = await ctx.fns.example.alertCount({});
        return n ? { icon: "ph-bell", label: `${n} alerts`, href: "/example/alerts", badge: n } : null;
        // or { icon, label, popup: trustedHtml } for a popover beside the Dock,
        // or a trusted HTML string for full control
    },
} satisfies types.dock.Item;
```

`render` runs on every page render with a short timeout (1.5 s); a throw, a timeout or `null` only leaves that entry out. Keep it to a cached read — never network or discovery on the render path. To keep a badge live, ship a small `$script_*.js` that re-fetches your own fragment on a `hyper-events` event you emit, as `mentions/$dock_mentions.ts` does.

Order and visibility are not the plugin's call: the `dock.layout` setting (`{ "top": [ids], "bottom": [ids], "hidden": [ids], "pins": [hrefs] }`) sets them for the instance (env `HYPER_DOCK`) and, per person, the Dock itself saves the person's copy when they drag, hide, pin or reset. Unknown ids are ignored, so removing a plugin never breaks a layout.

### Global menu widgets and search

The global menu (⌘/) has tabs on top (Home, Plugins, the person's own). While the search box is empty a tab shows a grid of widget tiles; once the person types, the tab's search sources answer in groups. Both come from plugin files; ids are `<namespace>.<name>`. Rows are always `types.nav.Item` and the menu draws them itself, so ⌘J/⌘K (rows), ⌘←/⌘→ (next widget or group), ↵, ⌘↵ and 📌 work everywhere.

```ts
// src/example/$widget_alerts.ts — a tile; the person may place it several times with different config
export default {
    title: "Alerts",
    icon: "ph-bell",
    description: "Open alerts of the example service",   // shown in the "Add widget" catalogue
    sizes: ["M", "S", "wide", "tall"],                    // first is the default; S 1×1, M 2×1, L 2×2, wide full row, tall one column × 3
    config: { level: { type: "string", default: "error", description: "Lowest level shown" } },
    ttl: 60,                                              // seconds the drawn tile is reused per person, size and config
    render: async (ctx, session, { size, config }) => {
        const rows = await ctx.fns.example.alerts({ level: config.level, limit: size === "S" ? 3 : 8 });
        return { items: rows.map(r => ({ id: `example:${r.id}`, label: r.title, href: `/example/${r.id}`, icon: "ph-bell", hint: r.level })) };
        // also: html (trusted, for non-list content), sections: [{ title, items, collapsed? }], columns: true
    },
} satisfies types.nav.Widget;
```

```ts
// src/example/$search_alerts.ts — a search source
export default {
    title: "Alerts",
    icon: "ph-bell",
    prefix: "!",          // optional: "!disk" asks only this source
    order: 60,            // group position, lower first
    search: async (ctx, session, { q, limit, signal }) =>
        (await ctx.fns.example.findAlerts({ q, limit })).map(r => ({ id: `example:${r.id}`, label: r.title, href: `/example/${r.id}` })),
} satisfies types.nav.Search;
```

`render` and `search` must only read and must check access for the current viewer. Each runs with its own timeout (2.5 s / 2 s); a throw or timeout shows "unavailable" in that tile or group only. A source slower than 300 ms gets a placeholder that fills in when it answers, so fast groups never wait. Keep `render` a cached read (use `ttl`) — opening the menu must not fan out to a dozen services.

A plugin widget nobody placed lands on the built-in **Plugins** tab automatically, next to the pages plugins declare with `$app_`. The person arranges the rest from the menu (pencil button): add, move, resize, remove tiles, add/rename/move/remove tabs, reset. That is stored in the `nav.layout` setting — for the instance (env `HYPER_NAV`) and per person. Unknown ids are ignored, so removing a plugin never breaks a layout.

### Settings

Declare settings with the existing `$setting_*.ts` mechanism; do not create a parallel manifest schema for types or defaults:

```ts
// src/example/$setting_enabled.ts
export default {
    type: "boolean",
    default: false,
    title: "Enable Example",
    description: "Allow status queries to the configured Example service.",
    env: "EXAMPLE_ENABLED",
};
```

Use `settings.get`/`settings.set` for values. An instance may fix a plugin's values in `~/.hyper/settings/$settings_<plugin>.json` (see docs/settings.md) — never ship such files inside the plugin. Setting keys come from namespace plus filename. Descriptor fields such as `type`, `default`, `env`, `title`, `description`, `options`, `min` and `max` belong in declarations and must match the consuming settings implementation. Never commit secret values as defaults, environment files, package metadata or SKILL.md examples. Use encrypted secret storage and references through supported consumers; never print secret values to discovery output or logs.

## Plugin-specific configuration

A mounted plugin has one detail page, `/plugins/:name`: **Overview** (default, `?tab=overview`) shows SKILL.md, **Settings** (`?tab=settings`) contains declared settings, safe secret status and the optional widget, and **Functions** (`?tab=functions`) shows generated live API documentation. The widget runs only when rendering Settings, not during catalogue browsing or other tabs. The compatibility GET `/plugins/:name/config` redirects to the Settings tab; its POST remains the form submission endpoint and redirects back after a successful save. Secret rows show references/status and secure-input guidance, not plaintext inputs.

Opt into a narrow form through `package.json` → `procs.configuration`, listing existing declared setting keys:

```json
{
  "procs": {
    "configuration": {
      "settings": ["example.enabled"],
      "secrets": [
        {
          "name": "apiToken",
          "ref": "secret://example/api-token",
          "title": "API token",
          "description": "Token for authenticated Example requests.",
          "required": true
        }
      ],
      "widget": "example.configurationWidget"
    }
  }
}
```

This is a fragment to merge into `procs`, not a replacement for `src` or other metadata. `settings` is optional and defaults to `[]`, allowing secret-only or widget-only configuration. `secrets` and `widget` are optional. Only these three configuration fields are accepted. List unique fully qualified keys owned by this mounted plugin. Types, defaults, ranges and choices come from the existing declarations, not from package.json. Neither settings nor widgets may borrow another plugin's namespace or stale/overridden runtime source.

`plugins.configuration({ name })` resolves this metadata for an exact mounted plugin without executing the widget. `plugins.saveConfiguration({ name, values })` validates the entire submitted form before writes; it rejects unknown keys, enforces finite numbers with declared bounds and enum membership, and supports `string`, `text`, `number`, `boolean` and `enum` values. Omitted booleans in this full form become false, so do not use it as a partial-update API. Other omitted fields are left unchanged. `reset: "example.enabled"` instead of `values` removes just that whitelisted global override, falling back to the environment/default.

Declare new credentials separately in `configuration.secrets`, not as ordinary settings. Each descriptor requires `name` and `ref`; optional fields are `title`, `description` and boolean `required`. Names and references must be unique; the `secret://namespace/name` namespace must belong to the plugin. At most 100 descriptors are accepted. The resolver reports `configured` from safe `secrets.list` metadata without retrieving plaintext. `required` is a declaration for consumers/UI, not proof that a credential is valid or an automatic network-access gate.

Legacy `$setting_*` declarations with `type: "secret"` remain read-only in this form: only configured status is exposed, never values, defaults or options. There is no automatic migration from legacy secret settings. Neither separate secret descriptors nor legacy secrets accept plaintext edits through `plugins.saveConfiguration`. Use secure secret input/storage and the plugin's documented reference consumer instead; declaring a `secret://` string alone does not make every setting consumer resolve it. Manifests hold references and safe labels, never secret values.

A configuration widget must be a mounted runtime function owned by the plugin, callable with `{}` and returning `Promise<string>` containing an HTML fragment. Keep GET rendering read-only: no sends, writes, account changes or other outward actions merely from visiting the page. Its HTML is trusted mounted-plugin code, not untrusted content made safe by a sandbox; escape external text. Any custom buttons/forms must target the plugin's own endpoints, whose authentication, authorization, CSRF defenses, input validation and explicit confirmation requirements remain the plugin author's responsibility. The generic settings whitelist does not authorize custom actions.

## Repository format: independent plugins in one repository

Use the same layout for a repository containing one plugin or several:

```text
<repository>/
  README.md                 # optional repository overview
  plugins/
    example/
      package.json
      SKILL.md
      src/example/status.ts
    another/
      package.json
      SKILL.md
      src/another/status.ts
```

Each `plugins/<name>` directory is a complete plugin package. Its directory basename must equal its validated `package.json` name (an unscoped lowercase plugin name); do not use repository names or arbitrary paths as substitutes for plugin identity. Each plugin owns independent runtime namespaces and must not require sibling plugins or shared repository-local runtime code. Calling built-in core procedures is still normal. No root bundle manifest, root package.json, shared dependency installation or root README is required. A repository groups source and Git history; it is not a combined runtime plugin.

Publish one selected plugin subtree at a time. Publication must preserve sibling plugins, unrelated root files and existing repository history; it must not replace the repository with the selected package. Legacy repositories with a plugin at the root remain readable for compatibility. Reading or publishing another plugin is not permission to silently move, delete or migrate that legacy root package. See `plugins/hyperhub/SKILL.md` for the provider's publication workflow and registry prerequisites.

Repository storage and runtime activation are separate. The current HyperHub materializer fetches the whole repository into temporary storage and copies only the selected plugin into the managed destination. This is not a persistent bundle cache or a repository-wide install/enable operation. A persistent repository cache with separately enabled plugin subtrees is planned, not implemented by that workflow. Keep installed managed copies under the configured `USER_PLUGINS` layout; do not manually point discovery at a proposed cache.

## Discovery is not installation

A plugin can be discoverable or available from a provider without being mounted. Use the plugin lifecycle APIs and their review/confirmation workflow to install, activate, replace or remove plugins; do not treat a search result, domain match, or configuration declaration as permission. Publishing is a separate outward action requiring its own explicit authorization.

Managed local copies have stricter limits than ordinary configured local mounts: `package.json` and `SKILL.md` are required, the name must be an unscoped lowercase basename, `procs.src` must stay inside the tree, and a nonempty source tree is required. Managed copies reject symlinks, embedded `.git`/`node_modules`, likely credential files, package scripts and nonempty dependency declarations; bounded file counts, sizes and metadata apply. Host/multi-plugin manifests are not installable as a plugin. These checks protect copying and provenance, not runtime isolation. Consult `plugins.validateTree` and the current provider workflow for exact limits instead of assuming discovery implies installability.
