/**
 * Read a memory file's text by key, absolute path or file:// url
 *
 * Shortcut for reading memory files: accepts a memory key (notes/x.md — nearest level first: agent, project,
 * user, system), an absolute path or a file:// url, and returns the file text with its absolute path and index
 * entry id when indexed. Use instead of memory.read when only the content is needed, e.g. to load a note or a
 * canvas page. Reads only inside the folders of levels this agent can see under ~/.hyper/memory.
 * @param opts.ref Memory key (notes/x.md), absolute path or file:// url of the file.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory key (notes/x.md), absolute path or file:// url of the file. */
        ref: string;
    },
): Promise<{ path: string; url: string; text: string; id: number | null; stale: boolean }> {
    const s = await ctx.fns.memory.scope({});
    const { resolve, relative, isAbsolute } = await import("node:path");
    // A path is visible when it lies in one of this agent's level folders and, for the system root, not inside
    // another level's folder (other people, projects and agents).
    const levelOf = (p: string): string | null => {
        for (const d of s.dirs) {
            const r = relative(d.dir, p);
            if (r === "" || r.startsWith("..") || isAbsolute(r)) continue;
            if (d.level === "system" && /^(users|projects|agents)(\/|$)/.test(r)) continue;
            return d.level;
        }
        return null;
    };
    let path: string | null = null;
    if (opts.ref.startsWith("file://")) path = resolve(opts.ref.slice(7));
    else if (isAbsolute(opts.ref)) path = resolve(opts.ref);
    else {
        for (const d of s.dirs) {
            const p = resolve(d.dir, opts.ref);
            if (levelOf(p) === d.level && await Bun.file(p).exists()) { path = p; break; }
        }
        if (!path) throw new Error(`memory.file: no memory file ${opts.ref}`);
    }
    if (!levelOf(path)) throw new Error("memory.file: path is outside the memory folders this agent can see");
    const f = Bun.file(path);
    if (!(await f.exists())) throw new Error(`memory.file: missing ${path}`);
    const text = await f.text();
    const url = "file://" + path;
    const rows: any[] = await ctx.fns.procs.db.select({ sql: `select id, meta->>'hash' as hash from memory where url = ? and ${s.visibleSql} limit 1`, params: [url, ...s.visibleParams] });
    const hash = new Bun.CryptoHasher("sha256").update(text).digest("hex");
    return { path, url, text, id: rows[0] ? Number(rows[0].id) : null, stale: !!rows[0]?.hash && rows[0].hash !== hash };
}
