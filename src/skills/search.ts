/**
 * Searches the installed and shared-folder Agent Skills by what they are for
 *
 * Use when the task may have a ready procedure — "review this diff", "write tests first", "fill a PDF form" — and the
 * skill list in context does not name one, or to find a skill a person can start with /name. Ranks by BM25 over name,
 * description and section headings, fused with vector similarity when embeddings are on; falls back to plain word
 * matching when the index cannot answer. Returns metadata only: load the chosen skill with the `skill` tool
 * (skills.use).
 * @param opts.query What the skill should help with, in a few words.
 * @param opts.limit Maximum skills returned. @default 8 @minimum 1 @maximum 50
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** What the skill should help with, in a few words. */
    query: string;
    /** Maximum skills returned. @default 8 @minimum 1 @maximum 50 */
    limit?: number;
}): Promise<Array<{ id: string; name: string; pack: string; description: string; trust: string; byModel: boolean; byUser: boolean; score: number; evidence: string }>> {
    const query = String(opts.query ?? "").trim();
    if (!query) throw new Error("skills.search: query is required");
    const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit ?? 8)) || 8));
    const ranks = new Map<string, { score: number; evidence: string }>();
    try {
        const keyword = await ctx.fns.procs.db.select({ sql: `SELECT id, paradedb.score(id) score FROM skill_docs WHERE search_text @@@ paradedb.match('search_text', ?) ORDER BY score DESC, id LIMIT ${limit * 3}`, params: [query] }) as any[];
        keyword.forEach((row, rank) => ranks.set(String(row.id), { score: 1 / (60 + rank + 1), evidence: "bm25" }));
        if (await ctx.fns.embeddings.provider({}) !== "off") {
            const vector = (await ctx.fns.embeddings.embed({ input: query })).vectors[0];
            if (vector) {
                const semantic = await ctx.fns.procs.db.select({ sql: `SELECT id FROM skill_docs WHERE embedding IS NOT NULL ORDER BY embedding <=> ?::public.halfvec LIMIT ${limit * 3}`, params: [JSON.stringify(vector)] }) as any[];
                semantic.forEach((row, rank) => {
                    const hit = ranks.get(String(row.id));
                    if (hit) { hit.score += 1 / (60 + rank + 1); hit.evidence = "hybrid"; }
                    else ranks.set(String(row.id), { score: 1 / (60 + rank + 1), evidence: "vector" });
                });
            }
        }
    } catch (error: any) {
        // The lexical pass below still answers; say why the index could not.
        ctx.fns.procs.log.debug({ event: "skills.search.index-failed", msg: String(error?.message ?? error) });
    }
    if (!ranks.size) {
        const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 1).slice(0, 8);
        for (const word of words) for (const skill of await ctx.fns.skills.list({ query: word, limit: 50 })) {
            const hit = ranks.get(skill.id) ?? { score: 0, evidence: "lexical" };
            hit.score += skill.name.includes(word) ? 8 : 2;
            ranks.set(skill.id, hit);
        }
    }
    const top = [...ranks.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, limit);
    const byId = new Map((await ctx.fns.skills.list({ ids: top.map(([id]) => id) })).map(skill => [skill.id, skill]));
    return top.filter(([id]) => byId.has(id)).map(([id, hit]) => {
        const skill = byId.get(id)!;
        return { id, name: skill.name, pack: skill.pack, description: skill.description, trust: skill.trust, byModel: skill.modelInvocable && skill.modelAllowed, byUser: skill.userInvocable, score: hit.score, evidence: hit.evidence };
    });
}
