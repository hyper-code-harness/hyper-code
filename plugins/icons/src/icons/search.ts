/**
 * Search bundled Lucide icons by English names and upstream tags
 *
 * Find exact names for icons.get or icons.set offline. Translate visual intent to English; matches upstream names and tags lexically.
 * @param opts.query English icon name or visual keywords.
 * @param opts.limit Maximum results. @default 5 @minimum 1 @maximum 30
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** English icon name or visual keywords. */
        query: string;
        /** Maximum results. @default 5 @minimum 1 @maximum 30 */
        limit?: number;
    },
): Promise<Array<{ name: string; tags: string[]; score: number }>> {
    const { query, limit = 5 } = opts;
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("limit must be an integer from 1 to 30");
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/[\s_-]+/).filter(Boolean);
    const { fileURLToPath } = await import("node:url");
    const rows: Array<{ name: string; tags: string[] }> = await Bun.file(fileURLToPath(new URL("../../assets/catalog.json", import.meta.url))).json();
    return rows.map(row => {
     const words = row.name.split("-");
     const tags = row.tags.map(t => t.toLowerCase());
     const scores: number[] = terms.map(term => words.includes(term) ? 10 : tags.includes(term) ? 6 : row.name.includes(term) ? 3 : tags.some(tag => tag.includes(term)) ? 1 : 0);
     return { ...row, score: scores.every(s => s > 0) ? scores.reduce((a,b) => a+b, 0) + (row.name === q ? 100 : 0) : 0 };
    }).filter(row => row.score > 0).sort((a,b) => b.score-a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
