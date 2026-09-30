// File watcher (on by default in dev; WATCH=0 opts out): save a file → it's live.
// Uses node:fs.watch (native FSEvents); needs Bun ≥1.3.14, which rewrote fs.watch
// — earlier builds silently stopped delivering recursive events in a long-lived
// process (the watcher just went quiet, no error).
// workflows; the agent's primary path is dev.def / dev.sync (synchronous).
// classify() decides what to do per file:
//   fn     → hot-load into ctx.fns (+ genTypes)
//   route  → http.loadRoutes
//   type   → genTypes
//   script · style → http.loadRoutes
// …and anything that changes what a page renders ends with events.reload(), which
// is a misnomer now: the browser re-requests the current URL into `#main` rather
// than reloading, so the chat, this event stream and every open tab survive it.
// Errors (syntax etc.) are logged + recorded on the error board, old version
// keeps running.
import { watch } from "node:fs";
import { resolve } from "node:path";
import { collectStateFile, dottedName, isLoaded } from "../boot/load";

/**
 * Watch the dev subsystem operation.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const st = ctx.state as any;
    if (st.watcher) return { watching: 'already' };

    // Watch the APP's src (== proc's core when running proc itself), so an app
    // booting proc as a dependency watches its own files, not proc's.
    const srcDir = resolve(ctx.fns.procs.project.projectRoot({}), 'src');
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
        timer = null;
        const batch = [...pending];
        pending.clear();
        let needTypes = false, needRoutes = false, needReload = false;

        // macOS FSEvents can collapse "new dir + files inside" into one event
        // on the dir — expand directory events into their contained files.
        const files: string[] = [];
        for (const rel of batch) {
            const abs = srcDir + '/' + rel;
            const stat = await Bun.file(abs).stat().catch(() => null);
            if (stat?.isDirectory()) {
                const glob = new Bun.Glob('**/*');
                for await (const sub of glob.scan(abs)) files.push(rel + '/' + sub);
            } else {
                files.push(rel);
            }
        }

        // Per-file error board: broken file → entry here; fixed → removed.
        // repl/$route__POST.ts attaches this to every REPL response, so whoever
        // writes files (agent, editor) sees load failures on the next call.
        const errors: Map<string, string> = ((ctx.state.procs.dev ??= {}).errors ??= new Map());

        for (const rel of files) {
            const entry = ctx.fns.procs.project.classify({ rel });
            if (entry.kind === 'skip') continue;
            const exists = await Bun.file(srcDir + '/' + rel).exists();
            // The call graph follows the file either way: a deleted file must
            // lose its edges, an edited one must gain the new ones. Best-effort
            // — an index that cannot update is not a reason to stop reloading.
            await ctx.fns.code.index({ rel }).catch(() => {});
            if (!exists) { errors.delete(rel); needTypes = true; continue; } // deleted: types only, fn stays in memory
            try {
                if (entry.kind === 'fn') {
                    await ctx.fns.procs.repl.load({ name: dottedName(entry) });
                    needTypes = true;
                    needReload = true;
                } else if (entry.kind === 'route' || entry.kind === 'script' || entry.kind === 'style') {
                    needRoutes = true;
                    needReload = true;
                } else if (entry.kind === 'type') {
                    needTypes = true;
                } else if (isLoaded(ctx, entry.kind)) {
                    await collectStateFile(ctx, entry, srcDir + "/" + rel);
                    needTypes = true; // config slots show up in CtxState
                }
                errors.delete(rel);
            } catch (e: any) {
                errors.set(rel, String(e?.message ?? e));
                console.error(`[watch] ${rel}: ${e?.message ?? e}`);
            }
        }

        try {
            if (needRoutes) await ctx.fns.procs.http.loadRoutes({});
            if (needTypes) await ctx.fns.procs.dev.genTypes({});
            if (needReload) ctx.fns.procs.events.reload({});
        } catch (e: any) {
            console.error(`[watch] post: ${e?.message ?? e}`);
        }
    };

    const watcher = watch(srcDir, { recursive: true }, (_event, rel) => {
        if (!rel) return;
        if (rel.endsWith('.d.ts')) return; // genTypes output — would loop
        if (rel.split('/').some(s => /^(_runtime|_test_.*|_tmp_.*|tmp_.*)$/.test(s))) return;
        pending.add(rel);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { flush().catch(e => console.error('[watch]', e)); }, 100);
    });
    st.watcher = watcher;
    ctx.fns.procs.log.info({ event: "watch.started", msg: srcDir });
    return { watching: srcDir };
}
