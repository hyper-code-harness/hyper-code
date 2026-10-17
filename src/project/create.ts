/**
 * Create a project with a slug, title and default working directory
 *
 * Inserts a project with the next short id (a, b, …) from the kv counter project:idCounter. The defaultDir becomes the workspace of agents assigned to the project and holds its memory under .hyper/memory/. The slug is lowerCamelCase and unique; it later names project functions (ctx.fns.project_<slug>). Use when the person wants a new project; attach agents with project.assign.
 * @param opts.slug Unique lowerCamelCase slug: a lowercase letter then letters or digits, up to 63 chars.
 * @param opts.title Human title.
 * @param opts.defaultDir Absolute working directory of the project (on defaultHost when given).
 * @param opts.defaultHost SSH host alias where defaultDir lives; empty means this machine. @default 
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique lowerCamelCase slug: a lowercase letter then letters or digits, up to 63 chars. */
        slug: string;
        /** Human title. */
        title: string;
        /** Absolute working directory of the project (on defaultHost when given). */
        defaultDir: string;
        /** SSH host alias where defaultDir lives; empty means this machine. @default  */
        defaultHost?: string;
    },
): Promise<{ id: string; slug: string; title: string; defaultDir: string | null; defaultHost: string; createdBy: string | null; createdAt: number; updatedAt: number; archivedAt: number | null }> {
    if (!/^[a-z][A-Za-z0-9]{0,62}$/.test(opts.slug)) throw new Error("project.create: slug must be lowerCamelCase, e.g. hyperDesign");
        if (!opts.defaultDir.startsWith("/")) throw new Error("project.create: defaultDir must be absolute");
        const host = String(opts.defaultHost ?? "").trim();
        if (!host) { const { stat } = await import("node:fs/promises"); const st = await stat(opts.defaultDir).catch(() => null); if (!st?.isDirectory()) throw new Error(`project.create: ${opts.defaultDir} is not a directory`); }
        if (await ctx.fns.project.get({ slug: opts.slug })) throw new Error(`project.create: slug ${opts.slug} is taken`);
        const c: any[] = await ctx.fns.procs.db.select({ sql: `INSERT INTO kv (key, value) VALUES ('project:idCounter', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(kv.value AS INTEGER) + 1 AS TEXT) RETURNING value`, params: [] });
        let n = Number(c[0].value), id = "";
        while (n > 0) { n -= 1; id = "abcdefghijklmnopqrstuvwxyz"[n % 26] + id; n = Math.floor(n / 26); }
        const now = Date.now();
        const userId = (session as any)?.agent?.createdBy ?? null;
        await ctx.fns.procs.db.run({ sql: "insert into projects (id, slug, title, default_dir, default_host, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)", params: [id, opts.slug, opts.title, opts.defaultDir.replace(/\/+$/, "") || "/", host, userId, now, now] });
        return (await ctx.fns.project.get({ id }))!;
}
