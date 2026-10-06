// Sync one file from disk into the live process, whatever it is.
// Companion to an external editor/Write: write file → dev.sync({rel}) → test.
import { collectStateFile, dottedName, isLoaded } from "../boot/load";
import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { Glob } from "bun";

/**
 * Synchronize sync for the dev subsystem.
 * @param opts.rel The rel value used by the operation.
 */
export default async function (ctx: Context, _session: Session | null, opts: { rel: string }) {
    const entry = ctx.fns.procs.project.classify({ rel: opts.rel });

    // Namespace lint gate (fn/type files affect the registry/types tree).
    if (entry.kind === 'fn' || entry.kind === 'type') {
        const lint = await ctx.fns.procs.dev.lint({ silent: true });
        if (!lint.ok) throw new Error(`src/${opts.rel} rejected by lint:\n` + lint.errors.map((e: string) => '  ✗ ' + e).join('\n'));
    }

    if (entry.kind === 'fn') {
        const name = dottedName(entry);
        await ctx.fns.procs.repl.load({ name });
        await ctx.fns.procs.dev.genTypes({});
        await ctx.fns.procs.styles.rebuild({});
        return { synced: opts.rel, as: 'ctx.fns.' + name };
    }
    if (entry.kind === 'route' || entry.kind === 'ws' || entry.kind === 'script' || entry.kind === 'style') {
        await ctx.fns.procs.http.loadRoutes({});
        await ctx.fns.procs.styles.rebuild({});
        const as = entry.kind === 'route' ? `${entry.method} ${entry.routePath}` : `GET ${entry.routePath}`;
        return { synced: opts.rel, as };
    }
    if (entry.kind === 'type') {
        await ctx.fns.procs.dev.genTypes({});
        return { synced: opts.rel, as: 'type' };
    }
    if (isLoaded(ctx, entry.kind)) {
        // Against the root that actually holds the file. A host supervising
        // somebody else's project has two — its own `src` and the project's —
        // and the file an agent just wrote is nearly always the project's.
        // Resolving only against the app root registered a path that is not
        // there, and it surfaced much later, as `Cannot find module` from
        // whoever tried to import it.
        const roots = [resolve(ctx.fns.procs.project.projectRoot({}), "src"), resolve(ctx.fns.procs.project.workdir({}), "src")];
        const abs = roots.map(root => resolve(root, opts.rel)).find(path => existsSync(path));
        if (!abs) throw new Error(`no such file: ${opts.rel} — looked under ${roots.join(" and ")}` + await didYouMean(roots, opts.rel));
        await collectStateFile(ctx, entry, abs);
        if (entry.kind === 'config') await ctx.fns.procs.dev.genTypes({}); // config types live in CtxState
        return { synced: opts.rel, as: entry.kind };
    }
    // A path that is a file but not a KIND: a test, a `$main`, a `.d.ts`, or a
    // name with no extension at all — which is what somebody typing the module
    // path (`vitals/list`) rather than the file path (`vitals/list.ts`) gets. Say
    // which it was and what to pass instead, because "nothing to sync" alone
    // reads as "the file is fine, the process is broken" and costs a restart.
    const roots = [resolve(ctx.fns.procs.project.projectRoot({}), "src"), resolve(ctx.fns.procs.project.workdir({}), "src")];
    throw new Error(
        `nothing to sync: ${opts.rel} — ${entry.kind}${(entry as any).reason ? `: ${(entry as any).reason}` : ""}.`
        + ` A path here is a FILE inside src, with its extension: \`vitals/list.ts\`, \`ehr/$route__GET.ts\`, \`forms/$qr_phq2.json\`.`
        + await didYouMean(roots, opts.rel));
}

// What they probably meant: the same name with an extension, or a file that ends
// the same way. Three at most — a wall of paths is another thing to read.
async function didYouMean(roots: string[], rel: string): Promise<string> {
    const stem = basename(rel).replace(/\.[^.]+$/, "").toLowerCase();
    if (!stem) return "";
    const found: string[] = [];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        for await (const path of new Glob("**/*.{ts,js,json,css}").scan({ cwd: root })) {
            if (basename(path).replace(/\.[^.]+$/, "").toLowerCase() === stem || path.toLowerCase().endsWith(rel.toLowerCase())) {
                if (!found.includes(path)) found.push(path);
            }
            if (found.length >= 3) break;
        }
        if (found.length >= 3) break;
    }
    return found.length ? `\n  did you mean: ${found.join(" · ")}` : "";
}
