import { basename, dirname } from "node:path";

const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

// A moduleDir ("." at the src root) → its path/namespace segments. ONE place for
// the "." special case (reused by lint, which nests the same way).
export const segments = (moduleDir: string): string[] => moduleDir === '.' ? [] : moduleDir.split('/');

// Build a URL path from a moduleDir + extra parts: join, drop empties, and turn
// a leading-`$` segment into a `:param`. Shared by the route and middleware
// branches so route paths and middleware prefixes parse identically.
const toPath = (moduleDir: string, parts: string[]): string =>
    '/' + [...segments(moduleDir), ...parts].filter(Boolean).map(s => s.startsWith('$') ? ':' + s.slice(1) : s).join('/');

// One shape, not a union of them. Kinds are OPEN — a module adds one by shipping
// a `$loader_<kind>.ts` — so a discriminated union would be a lie: TypeScript
// cannot narrow `kind === "route"` when `kind` is also every string a module
// might invent. So: every field a kind may carry, optional, and the loader of
// that kind knows which ones are there.
export type ProjectEntry = {
    kind: string;                 // "fn" · "route" · "type" · … · whatever a module owns
    rel: string;                  // path inside the src root that shipped it
    moduleDir: string;            // its directory → the module's dotted name ("." at the root)
    fileName: string;
    runtimeName?: string;         // fn
    typeName?: string;            // type
    routePath?: string;           // route · script · style
    method?: string;              // route
    prefix?: string;              // middleware
    stateKey?: string;            // legacy $state_<key>
    hook?: "start" | "stop";      // lifecycle
    hookName?: string;            // hook
    migrationId?: string;         // migration
    command?: string;             // cli
    loaderKind?: string;          // loader — the kind it owns
    name?: string;                // a kind somebody else owns: $<kind>_<name>
    reason?: string;              // skip
};

/**
 * Classifies one source-relative file path according to the procedural filename grammar.
 * @param opts.rel POSIX-style path relative to a discovered source root.
 */
export default function (_ctx: Context, _session: Session | null, opts: { rel: string }): ProjectEntry {
    const rel = opts.rel;
    const moduleDir = dirname(rel);
    const fileName = basename(rel);

    // $style_<name>.css → a Tailwind input, compiled against the whole scan and
    // served at /<module>/<name>.css. Comes before $script so a stylesheet is not
    // treated as a raw asset.
    if (/^\$style_.+\.css$/.test(fileName)) {
        const name = fileName.slice("$style_".length, -".css".length);
        if (!name) return { kind: "skip", rel, moduleDir, fileName, reason: "bad-style-name" };
        return { kind: "style", rel, moduleDir, fileName, routePath: "/" + [...segments(moduleDir), name + ".css"].join("/") };
    }

    if (/^\$script_.+\.(js|mjs|css)$/.test(fileName)) {
        const m = /^\$script_(.+?)(\.\w+)$/.exec(fileName);
        if (!m || !m[1] || !m[2]) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-script-name' };
        return { kind: 'script', rel, moduleDir, fileName, routePath: '/' + [...segments(moduleDir), m[1] + m[2]].join('/') };
    }

    // `$loader_<kind>.ts` — this file owns a kind. It is the one thing the scan
    // parses without consulting the loader table, because it is what fills the
    // table: a loader cannot be produced by a loader, so there is no recursion
    // to bound and no ordering to argue about.
    if (/^\$loader_.+\.ts$/.test(fileName)) {
        const loaderKind = fileName.slice("$loader_".length, -".ts".length);
        if (!loaderKind) return { kind: "skip", rel, moduleDir, fileName, reason: "bad-loader-name" };
        return { kind: "loader", rel, moduleDir, fileName, loaderKind };
    }

    if (rel.endsWith('.d.ts')) return { kind: 'skip', rel, moduleDir, fileName, reason: 'dts' };
    if (rel.endsWith('.test.ts')) return { kind: 'skip', rel, moduleDir, fileName, reason: 'test' };
    if (rel.endsWith('.entry.ts')) return { kind: 'skip', rel, moduleDir, fileName, reason: 'entry' };
    // Not TypeScript — but a kind may live in any format at all, so a `$<kind>_`
    // name is read before the file is written off.
    if (!rel.endsWith('.ts')) {
        const tagged = taggedKind(fileName);
        return tagged ? { ...tagged, rel, moduleDir, fileName } : { kind: 'skip', rel, moduleDir, fileName, reason: 'non-ts' };
    }

    const stem = basename(rel, '.ts');
    if (stem === '$main' || stem === '$test') return { kind: 'skip', rel, moduleDir, fileName, reason: 'reserved' };

    // Deprecated spelling of the same thing; `dev.lint` says so by name.
    if (stem.startsWith('$type_')) {
        const typeName = stem.slice('$type_'.length);
        if (!typeName) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-type-name' };
        return { kind: 'type', rel, moduleDir, fileName, typeName };
    }

    if (stem.startsWith('$route_')) {
        const rest = stem.slice('$route_'.length);
        const idx = rest.lastIndexOf('_');
        const pathRaw = idx === -1 ? '' : rest.slice(0, idx);
        const method = idx === -1 ? rest : rest.slice(idx + 1);
        if (!METHODS.has(method)) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-route-method' };
        const pathParts = pathRaw === '' ? [] : pathRaw.split('_');
        return { kind: 'route', rel, moduleDir, fileName, routePath: toPath(moduleDir, pathParts), method };
    }

    // $ws_<path>.ts → a WebSocket endpoint at the same address grammar as a
    // route (`_` → `/`, `$id` → `:id`); bare `$ws.ts` is the module path itself.
    // It default-exports { upgrade?, open?, message?, close?, drain? } and is
    // reached through the same middleware (auth, cookies) as any request.
    if (stem === '$ws' || stem.startsWith('$ws_')) {
        const rest = stem === '$ws' ? '' : stem.slice('$ws_'.length);
        const pathParts = rest === '' ? [] : rest.split('_');
        return { kind: 'ws', rel, moduleDir, fileName, routePath: toPath(moduleDir, pathParts), method: 'WS' };
    }

    // $middleware[_<path>].ts → runs before handlers under its path prefix; may
    // mutate the session. Bare $middleware.ts → the whole module path; the _<path>
    // suffix extends it (_ → /, $id → :id wildcard segment).
    if (stem === '$middleware' || stem.startsWith('$middleware_')) {
        const rest = stem === '$middleware' ? '' : stem.slice('$middleware_'.length);
        const pathParts = rest === '' ? [] : rest.split('_');
        return { kind: 'middleware', rel, moduleDir, fileName, prefix: toPath(moduleDir, pathParts) };
    }

    // $state_<key>.ts → declares the type of ctx.state.<key> (the file exports
    // `type <key>`). Types only; the value is set at runtime by fns/middleware.
    if (stem.startsWith('$state_')) {
        const stateKey = stem.slice('$state_'.length);
        if (!stateKey) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-state-name' };
        return { kind: 'state', rel, moduleDir, fileName, stateKey };
    }

    // $start.ts / $stop.ts → module lifecycle hooks (init / teardown of ctx),
    // run by ctx.fns.procs.lifecycle.* in the order declared in package.json proc.prod.
    if (stem === '$start' || stem === '$stop') {
        return { kind: 'lifecycle', rel, moduleDir, fileName, hook: stem.slice(1) as 'start' | 'stop' };
    }

    // $config.ts → a module's config schema (default-exports a ConfigSchema).
    // Collected into ctx.state.procs?.config?.schemas; modules never import it — they
    // read config via ctx.fns.procs.config.resolve({ module }).
    if (stem === '$config') return { kind: 'config', rel, moduleDir, fileName };

    // $point_<name>.ts → DECLARES an extension point, named by its module:
    // `ui/$point_chrome.ts` is the point `ui.chrome`. Answering an undeclared
    // point is a typo, and `dev.lint` says so by name.
    if (stem.startsWith('$point_')) {
        const pointName = stem.slice('$point_'.length);
        if (!pointName) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-point-name' };
        return { kind: 'point', rel, moduleDir, fileName, name: pointName };
    }

    // $hook_<name>.ts → a named extension point handler, auto-registered under
    // <name> (id = module). Run via ctx.fns.procs.hooks.run/first({ name }).
    if (stem.startsWith('$hook_')) {
        const hookName = stem.slice('$hook_'.length);
        if (!hookName) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-hook-name' };
        return { kind: 'hook', rel, moduleDir, fileName, hookName };
    }

    // $migration_<id>.ts → a db migration (default-exports { up, down? }); run in
    // id order by ctx.fns.procs.migrate.up, tracked in the _migrations table.
    if (stem.startsWith('$migration_')) {
        const migrationId = stem.slice('$migration_'.length);
        if (!migrationId) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-migration-name' };
        return { kind: 'migration', rel, moduleDir, fileName, migrationId };
    }

    // $cli_<command>.ts → a CLI command (default fn (ctx, session, opts)); `_`
    // becomes `:` (e.g. $cli_db_seed.ts → `db:seed`). Run by ctx.fns.procs.cli.run.
    if (stem.startsWith('$cli_')) {
        const command = stem.slice('$cli_'.length).replaceAll('_', ':');
        if (!command) return { kind: 'skip', rel, moduleDir, fileName, reason: 'bad-cli-name' };
        return { kind: 'cli', rel, moduleDir, fileName, command };
    }

    // A file whose name starts with a capital is a TYPE — `hs/ui/Button.ts` is
    // `types.hs.ui.Button`. It is the one thing here that is not a function and
    // not loaded at all (only genTypes reads it), so it is marked by its case
    // rather than by a `$`, which in this grammar means "the loader parses this".
    if (/^[A-Z]/.test(stem)) return { kind: "type", rel, moduleDir, fileName, typeName: stem };

    // `$<kind>_<name>` in any extension — asked after the shapes the framework
    // parses itself, so a module can add kinds but never redefine one. The kind
    // is simply the prefix: classify reads a name, it does not consult the table
    // of loaders. Whether anybody owns `phrase` is a question for load time, and
    // asking it here would make what a file IS depend on what has been scanned
    // so far.
    const tagged = taggedKind(fileName);
    if (tagged) return { ...tagged, rel, moduleDir, fileName };

    const runtimeName = stem.startsWith('$') ? stem.slice(1) : stem;
    return { kind: 'fn', rel, moduleDir, fileName, runtimeName };
}

// `$<kind>_<name>` → that kind, whoever owns it. A typo in the prefix reads as
// "nobody owns this kind" at load time, with the file named — not as silence.
function taggedKind(fileName: string): { kind: string; name: string } | null {
    const m = /^\$([a-z][a-z0-9]*)_(.+)$/.exec(stemOrName(fileName));
    if (!m) return null;
    return { kind: m[1]!, name: m[2]! };
}

// The name a `$<kind>_<name>` file is known by: without its extension for code,
// with the extension stripped for data too — `$qr_phq9.json` is `phq9`.
function stemOrName(fileName: string): string {
    return fileName.replace(/\.(ts|js|mjs|json|css|md|yaml|yml)$/, "");
}
