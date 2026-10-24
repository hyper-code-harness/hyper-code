/**
 * Finds what can be shown on the canvas: pages that open by address (`@view` functions, plugins' too), functions
 * that also put their result on a tab (`@canvas <kind>`), and the loaded tab kinds.
 *
 * Use before canvas.show to find a ready page instead of writing html — "calendar day", "test results", "memory
 * table". Pages are ranked by the function index (runtime.docs.search with `tag: "view"` / `tag: "canvas"`), so
 * every plugin's views are found as soon as they load and the prompt never has to list them. Each result says how
 * to open it: a view gives its address `/rpc/<fn>?<json>` and its params signature. Query in English: the index is
 * English. An empty query lists everything.
 * @param opts.query What to show, in English, e.g. "calendar day" or "test run"; empty lists all.
 * @param opts.limit Maximum results. @default 20 @minimum 1 @maximum 100
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** What to show, in English, e.g. "calendar day" or "test run"; empty lists all. */
    query?: string;
    /** Maximum results. @default 20 @minimum 1 @maximum 100 */
    limit?: number;
}): Promise<Array<{ type: "kind" | "function"; name: string; kind: string; summary: string; usage: string; signature?: string }>> {
    const query = String(opts.query ?? "").trim();
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
    type Row = { type: "kind" | "function"; name: string; kind: string; summary: string; usage: string; signature?: string };
    const found = async (tag: string) => (await ctx.fns.runtime.docs.search({ query, tag, limit: Math.min(50, limit) }).catch(() => [])) as Array<{ name: string; summary: string; signature: string }>;
    const [views, shows] = await Promise.all([found("view"), found("canvas")]);
    const out: Row[] = [];
    for (const f of views) out.push({ type: "function", name: f.name, kind: "view", summary: f.summary, signature: f.signature, usage: `canvas.show({ kind: "view", args: { fn: "${f.name}", params } }) — address /rpc/${f.name}?<json params>` });
    for (const f of shows) {
        let kind = "";
        try { kind = String(ctx.fns.runtime.docs.get({ name: f.name }).canvas ?? ""); } catch { /* unloaded since indexing */ }
        out.push({ type: "function", name: f.name, kind, summary: f.summary, signature: f.signature, usage: `${f.name}({ …, canvas: true })` });
    }
    // Kinds are few and built in: plain word match on their hint.
    const words = query.toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(w => w.length > 1);
    const kinds = (await ctx.fns.canvas.kinds({}))
        .map(k => ({ k, hint: String(k.hint ?? "").trim() }))
        .map(({ k, hint }) => ({ k, hint, s: words.length ? words.filter(w => `${k.name} ${k.module} ${hint}`.toLowerCase().includes(w)).length : 1 }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || a.k.name.localeCompare(b.k.name));
    for (const { k, hint } of kinds) out.push({ type: "kind", name: k.name, kind: k.name, summary: hint || `canvas kind ${k.name}`, usage: `canvas.show({ kind: "${k.name}", args })` });
    // A function first when the query named it; otherwise the strongest kind match leads (e.g. "web page" → url).
    // A kind that only aliases a view (plugin kinds) never jumps ahead of the view itself.
    const registry = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const lead = kinds.find(x => !registry[x.k.name]?.view);
    const strongKind = lead && words.length && lead.s >= Math.max(2, words.length) ? lead.k.name : null;
    const ordered = strongKind ? [...out.filter(r => r.type === "kind" && r.name === strongKind), ...out.filter(r => !(r.type === "kind" && r.name === strongKind))] : out;
    return ordered.slice(0, limit);
}
