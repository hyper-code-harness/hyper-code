// Rebuild the route table from scratch and swap it in. Not a second collector
// any more: it scans, hands each kind to its loader out of the same table
// everything else uses, and only owns the two things a loader cannot — that the
// rebuild starts empty (a deleted file must leave no handler behind) and that
// the swap is atomic (a request mid-rebuild must not see a half-built table).
/**
 * Perform load routes for the http subsystem.
 * @param opts.strict The strict value used by the operation.
 */
export default async function (ctx: Context, _session: Session | null, opts: { strict?: boolean } = {}) {
    // A rebuild always rescans, the same way boot does (procs/boot/load.ts): a
    // production bundle (`dev.build`) keeps its baked list and adds what the scan
    // finds on top. NODE_ENV=production alone does not mean a bundle — a server
    // run from source with it used the list frozen at boot, so a $script_ added by
    // a later `git pull` never got a route (PR #27: /keys/keys.js was 401 and ⌘/
    // stopped working until a restart).
    const found = await ctx.fns.procs.project.scan({});
    const baked: any[] = (ctx.state as any).procs?.boot?.baked ?? [];
    const entries = baked.length
        ? [...baked, ...found.filter((e: any) => !baked.some((b: any) => b.abs === e.abs))]
        : found;
    const loaders = (ctx.state as any).procs?.boot?.loaders ?? {};

    // A derived ctx with empty tables: the loaders write into it exactly as they
    // do at boot, and the running server keeps serving the old ones meanwhile.
    const draft: any = Object.create(ctx);
    draft.state = {
        ...ctx.state,
        procs: { ...ctx.state.procs, http: { ...ctx.state.procs.http, routes: {}, middleware: [] }, styles: [] },
    };

    for (const kind of ["route", "ws", "middleware", "script", "style"]) {
        const loader = loaders[kind];
        const mine = entries.filter((e: any) => e.kind === kind);
        if (!loader || !mine.length) continue;
        try {
            await loader(draft, null, { entries: mine });
        } catch (error: any) {
            const message = `[$loader ${kind}] ${error?.message ?? error}`;
            console.error(message);
            if (opts.strict) throw new Error(message);
        }
    }

    // hyper-code2: a rescan keeps what this run already compiled. The fresh records came back
    // unbuilt, so the next page load started one Tailwind per sheet at once (11, load 110) after
    // every route or script save; `styles.rebuild` is what recompiles after a change.
    const previous = new Map((ctx.state.procs.styles ?? []).map((s: any) => [s.key, s]));
    for (const style of draft.state.procs.styles) {
        const built = (previous.get(style.key) as any)?.built;
        if (built) style.built = built;
    }
    ctx.state.procs.styles = draft.state.procs.styles;
    ctx.state.procs.http.middleware = draft.state.procs.http.middleware;
    ctx.state.procs.http.routes = draft.state.procs.http.routes;
    return ctx.state.procs?.http.routes;
}
