/**
 * Draws one widget placement as a menu tile body: runs the widget's render with its timeout, reuses a fresh
 * cached result within the widget's ttl (per viewer, size and config), and turns the output into HTML —
 * rows through nav.rows, titled sections, a folded section for `collapsed`. A throw or a timeout draws an
 * "unavailable" note instead of breaking the menu; null or nothing draws "empty".
 * @param opts.placement The placed widget (from nav.tabs).
 * @param opts.timeoutMs Render budget in milliseconds. @default 2500 @minimum 50 @maximum 10000
 * @param opts.fresh Skip the ttl cache and render now (the widget preview canvas uses it). @default false
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
    },
): Promise<{ ok: boolean; html: string; cached: boolean; error?: string; ms?: number }> {
    const state = ((ctx.state as any).nav ??= {});
    const def = (state.widgets ?? {})[opts.placement.widget] as (types.nav.Widget & types.nav.Registered) | undefined;
    const note = (text: string) => `<div class="px-2 py-2 text-xs text-faint">${text}</div>`;
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
        return { ok: false, html: note("unavailable"), cached: false, error: String(error?.stack ?? error?.message ?? error), ms: Math.round(performance.now() - started) };
    } finally { if (timer) clearTimeout(timer); }

    const output: types.nav.WidgetOutput = typeof out === "string" ? { html: out } : Array.isArray(out) ? { items: out } : out ?? {};
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
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
        const count = section.count !== undefined ? ` · ${section.count}` : "";
        if (section.collapsed) {
            sectionParts.push(`<details class="mt-3 border-t border-ui-border pt-2"><summary class="cursor-pointer px-2 py-1 text-xs text-subtle">${esc(section.title)}${count}</summary>${body}</details>`);
            continue;
        }
        const tone = section.tone === "primary" ? "text-primary" : section.tone === "warning" ? "text-warning" : "text-faint";
        const head = section.title ? `<h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider ${tone}">${esc(section.title)}${count}</h4>` : "";
        sectionParts.push(`<section class="break-inside-avoid ${section.tone === "primary" ? "mb-3 border-b border-ui-border pb-2" : "mb-2"}">${head}${body}</section>`);
    }
    if (sectionParts.length) parts.push(output.columns ? `<div class="gap-x-4 sm:columns-2 lg:columns-3">${sectionParts.join("")}</div>` : sectionParts.join(""));
    const html = parts.join("") || note("empty");
    if (ttl) cache.set(key, { at: Date.now(), html });
    return { ok: true, html, cached: false, ms: Math.round(performance.now() - started) };
}
