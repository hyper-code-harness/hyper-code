/**
 * Finds what can be shown on the canvas: loaded tab kinds and the functions that show their result there.
 *
 * Use before canvas.show when the wanted kind is not one of the built-ins listed in the prompt, or to find a
 * function that both returns data and puts the same selection in front of the person — such functions
 * carry `@canvas <kind>` in their JSDoc and take `canvas: true`. Matches every query word against name,
 * description and hint; an empty query lists everything.
 * @param opts.query Words to look for, e.g. "health diary" or "slides"; empty lists all.
 * @param opts.limit Maximum results. @default 20
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Words to look for, e.g. "health diary" or "slides"; empty lists all. */
    query?: string;
    /** Maximum results. @default 20 @minimum 1 @maximum 100 */
    limit?: number;
}): Promise<Array<{ type: "kind" | "function"; name: string; kind: string; summary: string; usage: string }>> {
    const words = String(opts.query ?? "").toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(w => w.length > 1);
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
    const out: Array<{ type: "kind" | "function"; name: string; kind: string; summary: string; usage: string; text: string }> = [];
    for (const k of await ctx.fns.canvas.kinds({})) {
        const hint = String(k.hint ?? "").trim();
        out.push({ type: "kind", name: k.name, kind: k.name, summary: hint || `canvas kind ${k.name}`, usage: `canvas.show({ kind: "${k.name}", args })`, text: `${k.name} ${k.module} ${hint}` });
    }
    for (const item of ctx.fns.runtime.docs.list({})) {
        let meta: Record<string, any>;
        try { meta = ctx.fns.runtime.docs.get({ name: item.name }); } catch { continue; }
        if (!meta.canvas) continue;
        out.push({ type: "function", name: meta.name, kind: String(meta.canvas), summary: String(meta.summary ?? ""), usage: `${meta.name}({ …, canvas: true })`, text: `${meta.name} ${meta.canvas} ${meta.doc ?? ""}` });
    }
    const score = (text: string) => { const t = text.toLowerCase(); return words.filter(w => t.includes(w)).length; };
    return out
        .map(r => ({ r, s: words.length ? score(r.text) : 1 }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || (a.r.type === b.r.type ? a.r.name.localeCompare(b.r.name) : a.r.type === "function" ? -1 : 1))
        .slice(0, limit)
        .map(({ r: { text: _t, ...rest } }) => rest);
}
