// Define a function/route synchronously: write file + load + genTypes in one
// call. Errors are immediate (not a watcher race): broken code → this throws,
// nothing half-registered. The agent's primary way to add code:
//   await ctx.fns.procs.dev.def({ name: "math.fib", code: "export default ..." })
//   await ctx.fns.procs.dev.def({ rel: "math/$route__GET.ts", code: "..." })
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { collectStateFile, dottedName, isLoaded } from "../boot/load";

/**
 * Perform def for the dev subsystem.
 * @param opts.name The target name.
 * @param opts.rel The rel value used by the operation.
 * @param opts.code The code to process.
 */
export default async function (ctx: Context, _session: Session | null, opts: { name?: string; rel?: string; code: string }) {
    let rel = opts.rel;
    if (!rel && opts.name) {
        const segs = opts.name.split('.');
        const fnName = segs.pop()!;
        if (segs.length === 0) throw new Error(`name must be "module.fn", got: ${opts.name}`);
        rel = segs.join('/') + '/' + fnName + '.ts';
    }
    if (!rel) throw new Error('need opts.name ("module.fn") or opts.rel ("module/file.ts")');

    const entry = ctx.fns.procs.project.classify({ rel });
    if (entry.kind === 'skip') throw new Error(`${rel} would be skipped by scanner: ${entry.reason}`);

    // Validate before touching disk: parse error → throw, no file written.
    new Bun.Transpiler({ loader: 'ts' }).transformSync(opts.code);

    // Write into the APP's src (not proc's core) — same dir genTypes/sync target,
    // so an app booting proc as a dependency writes its own tree, not proc's.
    const abs = resolve(ctx.fns.procs.project.projectRoot({}), 'src', rel);
    const existed = await Bun.file(abs).exists();
    await Bun.write(abs, opts.code);

    // Namespace lint: a bad name / collision must never enter the registry.
    const lint = await ctx.fns.procs.dev.lint({ silent: true });
    if (!lint.ok) {
        if (!existed) await rm(abs).catch(() => {});
        throw new Error(`src/${rel} rejected by lint:\n` + lint.errors.map((e: string) => '  ✗ ' + e).join('\n'));
    }

    try {
        if (entry.kind === 'fn') {
            await ctx.fns.procs.repl.load({ name: dottedName(entry) });
        } else if (entry.kind === 'route' || entry.kind === 'ws' || entry.kind === 'script') {
            await ctx.fns.procs.http.loadRoutes({});
        } else if (isLoaded(ctx, entry.kind)) {
            await collectStateFile(ctx, entry, abs);
        }
        await ctx.fns.procs.dev.genTypes({});
    } catch (e: any) {
        if (!existed) await rm(abs).catch(() => {}); // roll back the file we just wrote (mirrors the lint path)
        throw new Error(`src/${rel} written but failed to load: ${e?.message ?? e}`);
    }

    const as = entry.kind === 'fn' ? `ctx.fns.${dottedName(entry)}`
        : entry.kind === 'route' ? `${entry.method} ${entry.routePath}`
        : entry.kind === 'script' ? `GET ${entry.routePath}` : rel;
    ctx.fns.procs.log.info({ event: existed ? 'def.redefined' : 'def.defined', msg: as, from: `src/${rel}` });
    // Fixed shape (callers can destructure it, unlike a dynamic key).
    return { as, file: `src/${rel}`, kind: entry.kind, redefined: existed };
}
