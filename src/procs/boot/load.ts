// Scan src/ for function files and register raw fns into ctx.state.registry
// (ctx.fns is an injecting Proxy over it — see $main.ts). Root-level $name.ts
// become injecting getters directly on ctx (ctx.genTypes, ctx.layout, ...).
// Bootstrap: registry is empty when this runs, so we import project/scan
// directly for the first sweep.
import { relative, resolve } from "node:path";

// Kinds nobody loads because there is nothing to load: `$state_`/`Name.ts` are
// types, and `$start`/`$stop` are run by lifecycle.start when its turn comes.
const NOT_LOADED = new Set(["state", "lifecycle"]);

// A module that supplies a service answers the family point `services.service.*`
// (declared by libs/services), so the suffix of that hook name is the service it
// provides — `$hook_services.service.aidbox.ts` provides "aidbox".
const SERVICE_HOOK = "services.service.";

/**
 * Load the boot subsystem operation.
 * @param opts.strict Fail loading when any discovered runtime file cannot be imported. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: { strict?: boolean } = {}): Promise<void> {
    const { default: scan } = await import("../project/scan?t=" + Date.now());
    const { default: modules } = await import("../modules/discover?t=" + Date.now());
    const found = await scan(ctx, null, {});
    // A production bundle has no filesystem to scan: its file list was baked in.
    // It still MOUNTS things at runtime (the project a workspace supervises), and
    // a scan then finds only that — so the baked list is kept and the newcomers
    // are added to it, rather than replacing everything with a handful.
    const baked: any[] = (ctx.state as any).procs?.boot?.baked ?? [];
    const entries = baked.length
        ? [...baked, ...found.filter((e: any) => !baked.some((b: any) => b.abs === e.abs))]
        : found;
    await apply(ctx, entries, await modules(ctx, null, {}), { strict: opts.strict === true });
}

// Turn a list of entries into a running process. Both worlds go through here —
// dev hands it what the scan found, a production build hands it the same list
// baked into static imports (`entry.fn` already resolved) — so there is ONE
// implementation of what a `$route_` or a `$hook_` MEANS, not two that drift.
export async function apply(ctx: Context, entries: any[], mounted: any[], opts: { strict?: boolean } = {}): Promise<void> {
    // Kept so anything that needs the file list after boot (lifecycle order, the
    assertUserPluginCollisions(entries, mounted);
    // module records, a build) can read it instead of scanning again.
    (((ctx.state as any).procs ??= {}).boot ??= {}).entries = entries;
    // The framework's own loaders are imported by name before anything else —
    // that is bootstrap, not loading, and it is what lets phase A hand functions
    // to `loaders.fn` instead of registering them a second way.
    const loaders = ((((ctx.state as any).procs ??= {}).boot ??= {}).loaders ??= {});
    await loadCoreLoaders(ctx, entries);

    // ── Phase A · every function ──────────────────────────────────────────────
    // Every `.ts` file is a function — a route handler, a hook, a lifecycle
    // step and a loader are all `export default function (ctx, session, opts)`.
    // So they are imported once, here, and what comes back is kept on the entry.
    // A `$type_` file is the exception: it is a type, and there is nothing to
    // run.
    //
    // Plain names go into the registry immediately; the `$` ones wait for their
    // loader, which will find them already imported rather than importing them
    // a second time.
    const importErrors: string[] = [];
    const failedImport = new Set<any>();
    for (const entry of entries) {
        if (entry.kind === "type" || entry.kind === "skip" || !entry.abs?.endsWith(".ts")) continue;
        try {
            // The whole module, not just the default: a loader may read a named
            // export too (a fence's `hint`), and re-importing to get it would
            // run the file twice.
            const imported = await import(entry.abs + `?t=${Date.now()}`);
            (entry as any).mod = imported;
            (entry as any).fn = imported.default;
        } catch (error: any) {
            const message = `[load] ${entry.rel}: ${error?.message ?? error}`;
            importErrors.push(message);
            console.error(message);
            // Remember the failure. A loader falls back to `entry.fn ?? await
            // import(...)`, which for a file that just failed means importing
            // it AGAIN, outside this try — turning one reported error into an
            // unhandled one that kills the boot. A plugin whose npm dependency
            // is missing must not take the process down with it.
            failedImport.add(entry);
            continue;
        }
    }
    if (opts.strict && importErrors.length) throw new Error(importErrors.join("\n"));
    const loadable = (list: any[]) => list.filter(e => !failedImport.has(e));
    await loaders.fn(ctx, null, { entries: loadable(entries.filter((e: any) => e.kind === "fn")) });

    // ── Phase B · the loaders ─────────────────────────────────────────────────
    // Now that every function exists, a loader may use any of them — log,
    // config, a validator from another module — instead of doing everything by
    // hand in a half-built world.
    //
    // The framework's own are registered by name, in a written order, before the
    // discovered ones: that list *is* the precedence rule, and it means the core
    // does not depend on the order a directory happened to be walked in.
    for (const entry of entries) {
        if (entry.kind !== "loader") continue;
        const loader = (entry as any).fn;
        if (typeof loader !== "function") continue;
        if (RESERVED_KINDS.has(entry.loaderKind) && entry.root !== "core") {
            console.error(`[$loader] "${entry.loaderKind}" belongs to the framework — pick another name (${entry.rel})`);
            continue;
        }
        loaders[entry.loaderKind] = loader;
        if (entry.root !== "core") ctx.fns.procs.log.debug({ event: "load.loader", msg: entry.loaderKind, from: source(entry) });
    }

    // The record of what is mounted, read by anything that lists the parts of
    // this process. What a mounted directory IS comes from its files.
    // One record per mounted TREE — a folder, a package, the app itself. It is
    // the unit of delivery: what may be excluded, configured, offered in a
    // catalogue. The names it brought are read off its files, because a name is
    // a path and nothing declares it.
    ctx.state.procs.modules = mounted.map((r): CtxState["modules"][number] => {
        const mine = entries.filter((e: any) => e.rootDir === r.dir);
        const routes = mine.filter((e: any) => e.kind === "route").map((e: any) => `${e.method} ${e.routePath}`);
        const namespaces = [...new Set(mine.map((e: any) => e.module).filter(Boolean))].sort();
        return {
            name: r.name,
            namespaces: namespaces as string[],
            label: r.label ?? r.name.slice(0, 1).toUpperCase() + r.name.slice(1),
            icon: r.icon ?? "ph-squares-four",
            description: r.description ?? "",
            source: r.source ?? "core", from: r.from ?? null, dir: r.folder ?? r.dir, config: r.config ?? {},
            domains: r.domains ?? [],
            // Carried through from `modules.discover`: `self` is the process
            // itself (the framework, this host's own src), `prefix` a supervised
            // project mounted under one. Neither is a module anybody manages, and
            // a page that cannot tell says so by listing them as modules.
            self: r.self === true, prefix: r.prefix ?? null, plugin: r.plugin === true,
            optional: r.optional === true,
            place: (r as any).place === "left" ? "left" : "right",
            skill: r.skill ?? null,
            // A top-level page of its own is what a host shows as a tab.
            tab: routes.some((route: string) => /^GET \/[a-z0-9-]+$/i.test(route)),
            // The urls of the browser scripts it ships — the layout links these
            // verbatim rather than guessing a name. The framework itself ships
            // two (the event stream and the page driver), so this is a list.
            // Either spelling counts: a route that serves it (the framework's)
            // or a plain `$script_client.js` (a module's). Only routes were read
            // once, and a module that shipped the file got its script served and
            // linked by nobody — which looks like "the key does nothing here".
            clients: [
                ...routes.filter((route: string) => route.endsWith("/client.js")).map((route: string) => route.slice("GET ".length)),
                ...mine.filter((e: any) => e.kind === "script" && e.routePath?.endsWith("/client.js")).map((e: any) => e.routePath),
            ],
            fns: mine.filter((e: any) => e.kind === "fn").map((e: any) => dottedName(e)),
            routes,
            hooks: mine.filter((e: any) => e.kind === "hook").map((e: any) => e.hookName),
            loaders: mine.filter((e: any) => e.kind === "loader").map((e: any) => e.loaderKind),
            provides: mine.filter((e: any) => e.kind === "hook" && e.hookName?.startsWith(SERVICE_HOOK)).map((e: any) => e.hookName.slice(SERVICE_HOOK.length)),
            preview: r.preview ?? null,
        };
    }).sort((a: any, b: any) => a.name.localeCompare(b.name));

    // ── Phase C · everything else, by its owner ───────────────────────────────
    // Kinds are processed in the order their loaders were registered, so the
    // sequence is the list in phase B rather than the order a glob returned
    // files in. A loader may take its files one at a time (`load`) or all at
    // once (`collect`), which is what a kind whose table is rebuilt atomically
    // needs.
    const byKind = new Map<string, any[]>();
    for (const entry of entries) {
        if (entry.kind === "fn" || entry.kind === "type" || entry.kind === "skip" || entry.kind === "loader") continue;
        if (failedImport.has(entry)) continue; // already reported; re-importing it would throw outside any handler
        (byKind.get(entry.kind) ?? byKind.set(entry.kind, []).get(entry.kind)!).push(entry);
    }
    for (const kind of [...Object.keys(loaders), ...byKind.keys()]) {
        const files = byKind.get(kind);
        if (!files) continue;
        byKind.delete(kind);
        const loader = loaders[kind];
        if (!loader) {
            // Kinds the framework still collects with code of its own rather
            // than with a loader — routes and their family, and the type-only
            // ones. They are on their way into the table; until then they are
            // not "unowned".
            if (!NOT_LOADED.has(kind)) console.warn(`[$loader] nobody owns "${kind}" — ${files.length} file(s) ignored, e.g. ${files[0].rel}`);
            continue;
        }
        try {
            await loader(ctx, null, { entries: files });
        } catch (error: any) {
            const message = `[$loader ${kind}] ${error?.message ?? error}`;
            console.error(message);
            if (opts.strict) throw new Error(message);
        }
    }

    // The project's skill links, reconciled with what is actually mounted. Here
    // rather than only in `modules.add`, because that covers one moment in one
    // process: a fresh clone, a hand-edited workspace.json and a plugin that
    // arrived with a git pull all leave the host mounting tools the agent has
    // never heard of. Never fatal — a link is a convenience, and a boot that
    // cannot write one still has to come up.
    await ctx.fns.procs.modules.linkAll({}).catch((error: any) =>
        console.warn(`[modules] could not link plugins into .claude/skills: ${error?.message ?? error}`));
}

// Collect a $config/$hook/$migration/$cli file into ctx.state — idempotent
// (re-running replaces in place; migrations dedupe by id, not push). Shared by
// loadFns (boot) and dev.sync/def (hot-reload) so these conventions hot-load.
export async function collectStateFile(ctx: Context, entry: any, abs: string): Promise<void> {
    // The hot-reload path and the boot path are the same path: one file goes to
    // whoever owns its kind, out of the same table. Anything else drifts — a
    // kind a module added would load at boot and quietly not reload.
    const loaders = ((((ctx.state as any).procs ??= {}).boot ??= {}).loaders ??= {});

    if (entry.kind === "loader") {
        // A loader itself: it is put in the table by the bootstrap, never by the
        // table, so this is the one branch that cannot be delegated.
        if (RESERVED_KINDS.has(entry.loaderKind)) {
            if (entry.root !== "core") console.error(`[$loader] "${entry.loaderKind}" belongs to the framework — pick another name (${entry.rel})`);
            return;
        }
        const loader = (await import(abs + `?t=${Date.now()}`)).default;
        if (typeof loader !== "function") return;
        loaders[entry.loaderKind] = loader;
        // hyper-code2: the classified entry handed in by dev.sync carries no
        // `abs` (it arrives as a separate argument), so labelling the source
        // off `entry` threw and hot-adding a $loader_ file was impossible.
        ctx.fns.procs.log.debug({ event: "load.loader", msg: entry.loaderKind, from: source({ ...entry, abs }) });
        return;
    }

    const loader = loaders[entry.kind];
    if (typeof loader !== "function") return;        // nobody owns it (any more)
    await loader(ctx, null, { entries: [{ ...entry, abs }] });
}


// Convention-file kinds collected into ctx.state (not the fn registry). loadFns
// (boot) and dev.def/sync/watch (hot-reload) all branch on this same set, so it
// lives in ONE place — collectStateFile knows how to handle each.
// The framework's own loaders, in the order they are registered. This list is
// the precedence rule, written down: everything here is in the table before the
// scan starts, so a module can add a kind but can never answer for one of these.
export const CORE_LOADERS = [
    "fn",         // a plain file is a function — the default, and the most common
    "config",     // a module's schema, needed by anything that resolves config
    "hook",       // extension points, needed before anyone runs
    "migration",  // collected here, applied by migrate.up
    "cli",        // commands for the registry-only boot
    "route",      // the route table…
    "middleware", // …and what runs before it
    "script",     // browser assets, bundled on request
    "style",      // Tailwind inputs, compiled and cached
] as const;

async function loadCoreLoaders(ctx: Context, entries: any[]): Promise<void> {
    const table = ((((ctx.state as any).procs ??= {}).boot ??= {}).loaders ??= {});
    const here = new URL("../", import.meta.url).pathname;   // src/procs/
    const at: Record<string, string> = {
        fn: "$loader_fn.ts", config: "config/$loader_config.ts", hook: "hooks/$loader_hook.ts",
        migration: "migrate/$loader_migration.ts", cli: "cli/$loader_cli.ts",
        route: "http/$loader_route.ts", middleware: "http/$loader_middleware.ts",
        script: "http/$loader_script.ts", style: "styles/$loader_style.ts",
    };
    for (const kind of CORE_LOADERS) {
        // A production build hands us the loader already imported (nothing can
        // be imported by path from inside a bundle); dev reads it off disk.
        const baked = entries.find(e => e.kind === "loader" && e.loaderKind === kind && typeof e.fn === "function");
        table[kind] = baked ? baked.fn : (await import(here + at[kind]! + `?t=${Date.now()}`)).default;
    }
}

// The prefixes the framework parses itself, because they are how the registry is
// assembled — nobody may claim them.
export const RESERVED_KINDS = new Set([
    'route', 'middleware', 'state', 'config', 'hook', 'migration', 'cli',
    'type', 'script', 'style', 'main', 'test', 'start', 'stop', 'loader',
]);

// Does anybody load this kind? Asked instead of a fixed list, so a kind a module
// added hot-reloads exactly like one the framework ships.
export function isLoaded(ctx: Context, kind: string): boolean {
    return kind === 'loader' || !!(ctx.state as any).procs?.boot?.loaders?.[kind];
}

// The dotted registry name for a fn entry: "module.sub.fn", or just "fn" for a
// root $name.ts (moduleDir === '.'). ONE definition — def/sync/watch all build
// this name, and the "." special case is exactly what dev.def used to get wrong
// (it produced "..fn" for root fns, so repl.load couldn't find them).
export function dottedName(e: { moduleDir: string; runtimeName?: string }): string {
    const name = e.runtimeName ?? '';
    return e.moduleDir === '.' ? name : e.moduleDir.replaceAll('/', '.') + '.' + name;
}

// An app has to be able to call its own functions, and it cannot know what it
// will be called: the same project is `app` in the workspace that builds it and
// `ehr` in the EHR that installs it. So a function belonging to a namespace is
// handed a ctx where `ctx.fns.app` is *itself* — the name a project writes in
// its own source — while everything else resolves as usual.
//
// The derived ctx keeps the real state (reads and writes pass through); only
// `registry` is swapped for a view of it, so a hot-reload that mutates the
// registry is seen here too.
export function bindSelf(fn: Function, namespace: string): Function {
    if (!namespace || namespace === "app") return fn;
    const bound = function (ctx: any, session: any, opts: any) {
        return fn.call(bound, selfAware(ctx, namespace), session, opts);
    };
    // The wrapper IS the function as far as everyone else is concerned, so it
    // carries the same metadata.
    (bound as any).meta = (fn as any).meta;
    return bound;
}

function selfAware(ctx: any, namespace: string): any {
    const derived = Object.create(ctx);
    // Who is calling. A module that keeps declarative artifacts for its callers
    // (questionnaires, charts) needs to answer with *this* app's copy, and there
    // is no other way to know which app asked.
    derived.namespace = namespace;
    derived.state = new Proxy(ctx.state, {
        get(target, key) {
            if (key !== "registry") return target[key as any];
            return new Proxy(target.registry, {
                get: (registry, name) => (name === "app" ? registry[namespace] : registry[name as any]),
                has: (registry, name) => name === "app" || name in registry,
            });
        },
        set(target, key, value) { target[key as any] = value; return true; },
    });
    return derived;
}

function assertUserPluginCollisions(entries: any[], mounted: any[]): void {
    const userRoots = new Set(mounted.filter((root: any) => root.source === "user").map((root: any) => root.dir));
    if (!userRoots.size) return;

    const owners = new Map<string, any>();
    const conflicts: string[] = [];
    for (const entry of entries) {
        const fnName = entry.moduleDir === "." ? entry.runtimeName : `${entry.moduleDir.replaceAll("/", ".")}.${entry.runtimeName}`;
        const key = entry.kind === "fn"
            ? `function ${fnName}`
            : entry.kind === "route" ? `route ${entry.method} ${entry.routePath}` : null;
        if (!key) continue;
        const previous = owners.get(key);
        if (previous && (userRoots.has(entry.rootDir) || userRoots.has(previous.rootDir))) {
            conflicts.push(`${key}: ${previous.root} conflicts with ${entry.root}`);
        } else if (!previous) {
            owners.set(key, entry);
        }
    }
    if (conflicts.length) throw new Error(`USER_PLUGINS collisions are not allowed:\n${conflicts.map(item => `  - ${item}`).join("\n")}`);
}


// Set value at a nested path in a tree, creating intermediate objects. Shared by
// loadFns and repl/load so registry nesting has ONE implementation.
// Read a nested slot by its path segments — the mirror of setPath.
export function getPath(root: any, segs: string[]): any {
    let node = root;
    for (const s of segs) { if (node == null) return undefined; node = node[s]; }
    return node;
}

export function setPath(root: any, segs: string[], value: any): void {
    let t = root;
    for (let i = 0; i < segs.length - 1; i++) t = (t[segs[i]!] ??= {});
    const last = segs[segs.length - 1]!;
    t[last] = value;
}

// A clean source label: the real file relative to the project root (modules live
// outside src/, so entry.root + entry.rel would double the namespace).
export function source(entry: { abs: string }): string {
    return relative(resolve(import.meta.dir, ".."), entry.abs);
}

// Root fns are injecting getters: ctx.fns.procs.dev.genTypes(opts) → raw(ctx, ctx.session, opts).
// `this` in the getter is the receiver, so request-ctxs inject their session.
