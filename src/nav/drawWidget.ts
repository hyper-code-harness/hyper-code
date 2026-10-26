/**
 * Draws one widget placement as a menu tile body: runs the widget's render with its timeout, reuses a fresh
 * cached result within the widget's ttl (per viewer, size and config), and turns the output into HTML —
 * rows through nav.rows, titled sections, a folded section for `collapsed`. A throw or a timeout draws an
 * "unavailable" note instead of breaking the menu; null or nothing draws "empty".
 * @param opts.placement The placed widget (from nav.tabs).
 * @param opts.timeoutMs Render budget in milliseconds. @default 2500 @minimum 50 @maximum 10000
 * @param opts.fresh Skip the ttl cache and render now (the widget preview canvas uses it). @default false
 * @param opts.peek Only look in the ttl cache: return the cached tile, or `pending: true` with empty html without
 * rendering (nav.home uses it for `lazy` widgets, whose body then arrives through GET /nav/widget). @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** The placed widget (from nav.tabs). */
        placement: types.nav.Placement;
        /** Render budget in milliseconds. @default 2500 @minimum 50 @maximum 10000 */
        timeoutMs?: number;
        /** Skip the ttl cache and render now (the widget preview canvas uses it). @default false */
        fresh?: boolean;
        /** Only look in the ttl cache: the cached tile, or `pending: true` without rendering. @default false */
        peek?: boolean;
    },
): Promise<{ ok: boolean; html: string; cached: boolean; pending?: boolean; error?: string; ms?: number }> {
    const state = ((ctx.state as any).nav ??= {});
    const def = (state.widgets ?? {})[opts.placement.widget] as (types.nav.Widget & types.nav.Registered) | undefined;
    const note = (text: string, danger = false) => ctx.fns.w.empty({ title: text, tone: danger ? "danger" : "neutral" });
    if (!def) return { ok: false, html: note("unknown widget"), cached: false };
    const size = opts.placement.size ?? def.sizes?.[0] ?? "M";
    const config: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(def.config ?? {})) if (spec.default !== undefined) config[key] = spec.default;
    Object.assign(config, opts.placement.config ?? {});
    const ttl = Math.max(0, Number(def.ttl ?? 0)) * 1000;
    const viewer = ttl ? await ctx.fns.auth.viewerId({}).catch(() => null) : null;
    const key = `${viewer ?? ""}|${def.id}|${size}|${JSON.stringify(config)}`;
    const cache: Map<string, { at: number; html: string }> = (state.widgetCache ??= new Map());
    const hit = ttl && !opts.fresh ? cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < ttl) return { ok: true, html: hit.html, cached: true };
    if (opts.peek) return { ok: true, html: "", cached: false, pending: true };

    const budget = Math.max(50, Math.min(10_000, opts.timeoutMs ?? 2500));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = performance.now();
    let out: types.nav.WidgetOutput | types.nav.Item[] | string | null;
    try {
        out = await Promise.race([
            Promise.resolve().then(() => def.render(ctx, _session, { size, config })),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget} ms`)), budget); }),
        ]);
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "nav.widget", msg: `${def.id}: ${String(error?.message ?? error)}`, from: def.rel });
        return { ok: false, html: note("unavailable", true), cached: false, error: String(error?.stack ?? error?.message ?? error), ms: Math.round(performance.now() - started) };
    } finally { if (timer) clearTimeout(timer); }

    const output: types.nav.WidgetOutput = typeof out === "string" ? { html: out } : Array.isArray(out) ? { items: out } : out ?? {};
    const pinned = await (async () => {
        const all = [...(output.items ?? []), ...(output.sections ?? []).flatMap(s => s.items ?? [])];
        if (!all.some(item => item.pin)) return new Set<string>();
        const [agents, layout] = await Promise.all([
            ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
            ctx.fns.dock.effectiveLayout({}).catch(() => ({ layout: { pins: [] as string[] } })),
        ]);
        return new Set([...[...agents].map(id => `agent:${id}`), ...(layout.layout.pins ?? []).map(href => `page:${href}`)]);
    })();
    const parts: string[] = [];
    if (output.html) parts.push(output.html);
    if (output.items?.length) parts.push(await ctx.fns.nav.rows({ items: output.items, pinned }));
    const sectionParts: string[] = [];
    for (const section of output.sections ?? []) {
        const body = (section.html ?? "") + (section.items?.length ? await ctx.fns.nav.rows({ items: section.items, pinned }) : "");
        if (!body) continue;
        sectionParts.push(ctx.fns.w.listSection({
            title: section.title || undefined,
            count: section.count,
            rows: body,
            tone: section.tone === "primary" ? "info" : section.tone,
            collapsed: section.collapsed ? true : undefined,
        }));
    }
    if (sectionParts.length) parts.push(output.columns ? ctx.fns.w.columns({ body: sectionParts.join("") }) : sectionParts.join(""));
    const html = parts.join("") || note("empty");
    if (ttl) cache.set(key, { at: Date.now(), html });
    return { ok: true, html, cached: false, ms: Math.round(performance.now() - started) };
}
