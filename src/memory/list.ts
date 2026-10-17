/**
 * List the memory entries the calling agent can see on all four levels: system, its person, its project, itself
 *
 * Returns index rows (no file content, no jsonb data) newest first, optionally filtered by level, type, kind or
 * key prefix. Each row says its `visibility` (agent, project, user, system) and, for files, the absolute
 * `file://` url under ~/.hyper/memory. Use it as the table of contents before deciding what to read with
 * memory.read or memory.file; `type: "code"` lists the functions of the user, project and agent levels.
 * @param opts.visibility Only entries of this level; all visible levels when omitted.
 * @param opts.type Only entries of this storage type.
 * @param opts.kind Only entries of this free-form kind.
 * @param opts.prefix Only keys starting with this prefix, e.g. notes/.
 * @param opts.limit Maximum rows to return. @default 100 @minimum 1 @maximum 1000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Only entries of this level; all visible levels when omitted. */
        visibility?: "agent" | "project" | "user" | "system";
        /** Only entries of this storage type. */
        type?: "file" | "code" | "jsonb";
        /** Only entries of this free-form kind. */
        kind?: string;
        /** Only keys starting with this prefix, e.g. notes/. */
        prefix?: string;
        /** Maximum rows to return. @default 100 @minimum 1 @maximum 1000 */
        limit?: number;
    },
): Promise<Array<{ id: number; visibility: string; type: string; kind: string | null; key: string; title: string; description: string; url: string | null; status: string | null; version: number; updatedAt: number }>> {
    const s = await ctx.fns.memory.scope({});
    const where = [s.visibleSql];
    const params: any[] = [...s.visibleParams];
    if (opts.visibility) { where.push("visibility = ?"); params.push(opts.visibility); }
    if (opts.type) { where.push("type = ?"); params.push(opts.type); }
    if (opts.kind) { where.push("kind = ?"); params.push(opts.kind); }
    if (opts.prefix) { where.push("key like ?"); params.push(opts.prefix.replace(/[%_\\]/g, (c: string) => "\\" + c) + "%"); }
    params.push(Math.min(Math.max(opts.limit ?? 100, 1), 1000));
    const rows: any[] = await ctx.fns.procs.db.select({ sql: `select id, visibility, type, kind, key, title, description, url, meta->>'status' as status, version, updated_at from memory where ${where.join(" and ")} order by updated_at desc limit ?`, params });
    return rows.map(r => ({ id: Number(r.id), visibility: r.visibility, type: r.type, kind: r.kind, key: r.key, title: r.title, description: r.description, url: r.url, status: r.status ?? null, version: Number(r.version), updatedAt: Number(r.updated_at) }));
}
