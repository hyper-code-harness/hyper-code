/**
 * Lists published context agents matching an optional task query
 *
 * Searches the shared context-agent registry by name, description, and capability labels. Use before delegating a standard task to a session with relevant accumulated context.
 * @param opts.query Optional words describing the desired task; blank returns the whole registry.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional words describing the desired task; blank returns the whole registry. */
        query?: string;
    },
): Promise<Array<{ agentId: string; name: string; description: string; capabilities: string[]; publishedAt: number; updatedAt: number }>> {
    const query = String(opts.query ?? "").trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT k.value FROM kv k JOIN agents a ON a.id = substring(k.key from 14) WHERE k.key LIKE 'shared-agent:%' AND a.archived_at IS NULL", params: [] }) as any[];
    const cards = rows.flatMap((row: any) => { try { return [JSON.parse(String(row.value))]; } catch { return []; } });
    const scored = cards.map((card: any) => { const text = [card.name, card.description, ...(Array.isArray(card.capabilities) ? card.capabilities : [])].join(" ").toLowerCase(); return { card, score: terms.reduce((sum: number, term: string) => sum + (text.includes(term) ? 1 : 0), 0) }; }).filter((item: any) => !terms.length || item.score > 0);
    scored.sort((a: any, b: any) => b.score - a.score || Number(b.card.updatedAt ?? 0) - Number(a.card.updatedAt ?? 0));
    return scored.map((item: any) => item.card);
}
