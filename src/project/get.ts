/**
 * Look up one project by id or slug
 *
 * Returns the project row (id, slug, title, defaultDir, defaultHost, timestamps) or null. Use to resolve a project reference before assigning agents or reading its memory.
 * @param opts.id Project id, e.g. a.
 * @param opts.slug Project slug in lowerCamelCase, e.g. hyperDesign.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Project id, e.g. a. */
        id?: string;
        /** Project slug in lowerCamelCase, e.g. hyperDesign. */
        slug?: string;
    },
): Promise<{ id: string; slug: string; title: string; defaultDir: string | null; defaultHost: string; createdBy: string | null; createdAt: number; updatedAt: number; archivedAt: number | null } | null> {
    if (!opts.id && !opts.slug) throw new Error("project.get: pass id or slug");
        const toProject = (r: any) => ({ id: r.id, slug: r.slug, title: r.title, defaultDir: r.default_dir ?? null, defaultHost: r.default_host ?? "", createdBy: r.created_by ?? null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), archivedAt: r.archived_at == null ? null : Number(r.archived_at) });
        const rows: any[] = await ctx.fns.procs.db.select({ sql: opts.id ? "select * from projects where id = ?" : "select * from projects where slug = ?", params: [opts.id ?? opts.slug] });
        return rows[0] ? toProject(rows[0]) : null;
}
