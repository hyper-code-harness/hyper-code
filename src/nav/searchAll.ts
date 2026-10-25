/**
 * Searches the global menu (⌘/): asks the search sources of the current tab in parallel, each with its own
 * timeout and an abort signal, and draws one titled group per source that found something.
 *
 * A query starting with a source's prefix (`@`, `/`, `#`) asks only the sources with that prefix, with the
 * prefix stripped. A source that throws or times out is shown as a one-line note, the others still answer.
 * Sources that answer within `inlineMs` are drawn at once; a slower one gets a placeholder that htmx fills
 * from GET /nav/group/:token when it answers (the search is not run twice), so fast groups never wait.
 * @param opts.q Search text as typed.
 * @param opts.tab Tab id whose sources are asked; the first tab when omitted.
 * @param opts.limit Rows per source. @default 12 @minimum 1 @maximum 100
 * @param opts.timeoutMs Budget per source in milliseconds. @default 2000 @minimum 50 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Search text as typed. */
        q: string;
        /** Tab id whose sources are asked; the first tab when omitted. */
        tab?: string;
        /** Rows per source. @default 12 @minimum 1 @maximum 100 */
        limit?: number;
        /** Budget per source in milliseconds. @default 2000 @minimum 50 @maximum 10000 */
        timeoutMs?: number;
        /** Wait this long for a source before drawing a placeholder for it; 0 waits for every source. @default 300 @minimum 0 */
        inlineMs?: number;
    },
): Promise<{ html: string; groups: Array<{ id: string; title: string; items: types.nav.Item[]; error?: string }>; pending: string[] }> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const registry = ((ctx.state as any).nav?.search ?? {}) as Record<string, types.nav.Search & types.nav.Registered>;
    const { tabs } = await ctx.fns.nav.tabs({});
    const tab = tabs.find(t => t.id === opts.tab) ?? tabs[0];
    let ids = tab ? tab.search : Object.keys(registry);
    let q = String(opts.q ?? "").trim();
    const prefixed = ids.filter(id => registry[id]?.prefix && q.startsWith(registry[id]!.prefix!));
    if (prefixed.length) {
        ids = prefixed;
        q = q.slice(registry[prefixed[0]!]!.prefix!.length).trim();
    }
    const limit = Math.max(1, Math.min(100, opts.limit ?? 12));
    const budget = Math.max(50, Math.min(10_000, opts.timeoutMs ?? 2000));
    const sources = ids.map(id => registry[id]!).filter(Boolean)
        .sort((a, b) => Number(a.order ?? 100) - Number(b.order ?? 100) || a.id.localeCompare(b.id));
    const run = async (source: types.nav.Search & types.nav.Registered) => {
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const items = await Promise.race([
                Promise.resolve().then(() => source.search(ctx, session, { q, limit, signal: abort.signal })),
                new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error(`timed out after ${budget} ms`)); }, budget); }),
            ]);
            return { id: source.id, title: source.title, items: (Array.isArray(items) ? items : []).slice(0, limit) } as Group;
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "nav.search", msg: `${source.id}: ${String(error?.message ?? error)}`, from: source.rel });
            return { id: source.id, title: source.title, items: [] as types.nav.Item[], error: String(error?.message ?? error) } as Group;
        } finally { if (timer) clearTimeout(timer); }
    };
    type Group = { id: string; title: string; items: types.nav.Item[]; error?: string };
    const inline = Math.max(0, opts.inlineMs ?? 300);
    const pending = sources.map(source => ({ source, promise: run(source) }));
    const settled = new Map<string, Group>();
    for (const p of pending) p.promise.then(g => settled.set(p.source.id, g));
    if (inline) await Promise.race([Promise.all(pending.map(p => p.promise)), Bun.sleep(inline)]);
    else await Promise.all(pending.map(p => p.promise));
    const [agentPins, layout] = await Promise.all([
        ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
        ctx.fns.dock.effectiveLayout({}).catch(() => ({ layout: { pins: [] as string[] } })),
    ]);
    const pinned = new Set([...[...agentPins].map(id => `agent:${id}`), ...(layout.layout.pins ?? []).map(href => `page:${href}`)]);
    const late: Record<string, Promise<string>> = ((ctx.state as any).nav ??= {}).lateGroups ??= {};
    const parts: string[] = [];
    const groups: Group[] = [];
    for (const { source, promise } of pending) {
        const group = settled.get(source.id);
        if (!group) {
            const token = crypto.randomUUID();
            late[token] = promise.then(g => ctx.fns.nav.groupHtml({ group: g, pinned }));
            setTimeout(() => { delete late[token]; }, budget + 30_000);
            parts.push(`<section data-nav-group="${esc(source.id)}" class="mb-2" hx-get="/nav/group/${token}" hx-trigger="load" hx-swap="outerHTML"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-faint">${esc(source.title)}</h4><div class="px-2 py-1 text-3xs text-faint">searching…</div></section>`);
            continue;
        }
        groups.push(group);
        parts.push(await ctx.fns.nav.groupHtml({ group, pinned }));
    }
    const html = parts.some(Boolean) ? `<div class="p-2">${parts.join("")}</div>` : `<div class="px-4 py-5 text-sm text-faint">nothing</div>`;
    return { html, groups, pending: pending.filter(p => !settled.has(p.source.id)).map(p => p.source.id) };
}
