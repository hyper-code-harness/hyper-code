/**
 * List projects with their default directories and agent counts
 *
 * Returns projects ordered by title with the number of agents attached to each. Archived projects are hidden unless includeArchived is true. Use to pick a project for a new agent or to show what projects exist.
 * @param opts.includeArchived Include archived projects. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Include archived projects. @default false */
        includeArchived?: boolean;
    },
): Promise<Array<{ id: string; slug: string; title: string; defaultDir: string | null; defaultHost: string; createdBy: string | null; createdAt: number; updatedAt: number; archivedAt: number | null ; agents: number }>> {
    const toProject = (r: any) => ({ id: r.id, slug: r.slug, title: r.title, defaultDir: r.default_dir ?? null, defaultHost: r.default_host ?? "", createdBy: r.created_by ?? null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), archivedAt: r.archived_at == null ? null : Number(r.archived_at) });
        const rows: any[] = await ctx.fns.procs.db.select({ sql: `select p.*, (select count(*) from agents a where a.project_id = p.id)::int as agents from projects p ${opts.includeArchived ? "" : "where p.archived_at is null"} order by p.title`, params: [] });
        return rows.map(r => ({ ...toProject(r), agents: Number(r.agents) }));
}
