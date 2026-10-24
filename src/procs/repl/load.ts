// Hot-reload functions from disk into the running process.
//   ctx.fns.procs.repl.load({ name: "project.scan" })  → reload one fn
//   ctx.fns.procs.repl.load({ name: "project" })       → reload whole module
//   ctx.fns.procs.repl.load({ name: "genTypes" })      → reload a root $name.ts fn
import { bindSelf, collectStateFile, isLoaded, setPath, source } from "../boot/load";

/**
 * Load the repl subsystem operation.
 * @param opts.name The target name.
 */
export default async function (ctx: Context, _session: Session | null, opts: { name: string }) {
    const target = opts.name;

    const entries = await ctx.fns.procs.project.scan({});

    if (target.includes('.')) {
        const segs = target.split('.');
        const fnName = segs.pop()!;
        const modPath = segs.join('/');
        await loadFile(ctx, entries, modPath, fnName);
        scheduleDocsIndex(ctx);
        return { reloaded: target };
    }

    const loaded: string[] = [];
    const others: string[] = [];
    for (const entry of entries) {
        if (entry.moduleDir !== target) continue;
        if (entry.kind !== 'fn') {
            // The module's declarative kinds ($canvas_, $fence_, $hook_, …) reload with it, through the
            // same loader table boot uses — otherwise a new canvas kind needed a restart. Only kinds whose
            // loader just (re)sets a keyed entry; routes have http.loadRoutes, crons and plugins own
            // schedules and mounts and keep their explicit reloads.
            if (!HOT_KINDS.has(entry.kind) || !isLoaded(ctx, entry.kind)) continue;
            await collectStateFile(ctx, entry, (entry as any).abs);
            others.push((entry as any).rel);
            continue;
        }
        await loadFile(ctx, entries, target, entry.runtimeName!);
        if (!loaded.includes(entry.runtimeName!)) loaded.push(entry.runtimeName!);
    }
    scheduleDocsIndex(ctx);
    return { reloaded: target, count: loaded.length, fns: loaded, ...(others.length ? { files: others } : {}) };
}

const HOT_KINDS = new Set(['canvas', 'fence', 'input', 'hook', 'point', 'tool', 'setting', 'compaction', 'app']);

// Reindex after a reload, once per burst: a series of repl.load calls (an agent reloading five functions,
// the watcher on a save) gives one pass DOCS_INDEX_DEBOUNCE_MS after the last one. Without LLM
// localization, like procs.modules.reload — that pass cost ~1.6 s of model calls on every reload and is
// left to runtime.docs.localizeNightly.
const DOCS_INDEX_DEBOUNCE_MS = 500;
function scheduleDocsIndex(ctx: Context): void {
    if (!(ctx.fns as any).runtime?.docs?.index) return;
    const state = ((ctx.state as any).replDocsIndex ??= {});
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        state.timer = undefined;
        (ctx.fns as any).runtime.docs.index({ localize: false }).catch((error: any) =>
            ctx.fns.procs.log.warn({ event: "runtime.docs.index.failed", msg: String(error?.message ?? error) }));
    }, DOCS_INDEX_DEBOUNCE_MS);
}


// `entries` is the one scan of this repl.load call: a module reload used to rescan
// the whole project once per function (20 scans for a 19-function module).
async function loadFile(ctx: Context, entries: any[], modPath: string, fnName: string) {
    // Look the fn up by its dotted registry path in the scan (which knows the
    // real abs path) — works for src AND module files (which live outside src/).
    const e = entries.find((x: any) => x.kind === 'fn' && x.moduleDir === modPath && x.runtimeName === fnName);
    if (!e) throw new Error(`no file for ${modPath}/${fnName}`);
    const m = await import((e as any).abs + `?t=${Date.now()}`);
    const fn = m.default;
    if (typeof fn !== 'function') throw new Error(`${(e as any).rel}: no default function export`);
    // Raw fns live in ctx.state.registry (ctx.fns is the injecting Proxy), and a
    // module's fn keeps seeing itself as `app` after a reload too.
    // Through the fn loader, so a hot-swapped function carries the same
    // metadata (name, module, file, docstring) a booted one does.
    const load = (ctx.state as any).procs?.boot?.loaders?.fn;
    if (load) await load(ctx, null, { entries: [{ ...(e as any), fn }] });
    else setPath(ctx.state.registry, [...modPath.split('/'), fnName], bindSelf(fn, (e as any).namespace));
    ctx.fns.procs.log.info({ event: "reload.fn", msg: `${modPath.replaceAll('/', '.')}.${fnName}`, from: source(e as any) });
}
