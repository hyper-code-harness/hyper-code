/**
 * Finds one memory row visible to the calling agent by id or key, nearest level first.
 *
 * Use inside memory.* readers and writers instead of repeating the visibility filter. A key may exist on several
 * levels; without `visibility` the nearest wins: agent, then project, then user, then system. Returns the raw
 * row plus `path` (the absolute file for file/code rows inside ~/.hyper/memory, else null) and `writable`
 * (whether this agent may change it: system rows only for the instance owner's agents).
 * @param opts.id Memory row id; takes precedence over key.
 * @param opts.key Memory key, e.g. notes/canvas-model.md or fn/project_hyperDesign.tables.
 * @param opts.visibility Only this level.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory row id; takes precedence over key. */
        id?: number;
        /** Memory key, e.g. notes/canvas-model.md or fn/project_hyperDesign.tables. */
        key?: string;
        /** Only this level. */
        visibility?: "agent" | "project" | "user" | "system";
    },
): Promise<{ row: Record<string, any>; path: string | null; writable: boolean } | null> {
    if (opts.id == null && !opts.key) throw new Error("memory: pass id or key");
    const s = await ctx.fns.memory.scope({});
    const where = [s.visibleSql];
    const params: any[] = [...s.visibleParams];
    if (opts.id != null) { where.push("id = ?"); params.push(opts.id); } else { where.push("key = ?"); params.push(opts.key); }
    if (opts.visibility) { where.push("visibility = ?"); params.push(opts.visibility); }
    const rows: any[] = await ctx.fns.procs.db.select({ sql: `select * from memory where ${where.join(" and ")} order by ${s.order} limit 1`, params });
    const row = rows[0];
    if (!row) return null;
    const { relative, resolve } = await import("node:path");
    let path: string | null = null;
    if (row.type !== "jsonb" && typeof row.url === "string" && row.url.startsWith("file://")) {
        const p = resolve(row.url.slice(7));
        const roots = [s.systemDir, resolve(s.srcDir)];
        if (roots.some(d => { const x = relative(d, p); return x !== "" && !x.startsWith(".."); })) path = p;
    }
    let writable = row.visibility !== "system";
    if (!writable && s.userId) writable = (await ctx.fns.procs.db.select({ sql: "select 1 from users where id = ? and role = 'owner'", params: [s.userId] })).length > 0;
    return { row, path, writable };
}
