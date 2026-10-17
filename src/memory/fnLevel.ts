/**
 * Tells which memory level a function module name belongs to: `user_<userId>`, `project_<slug>` or `agent_<id>`.
 *
 * Use wherever a function name or a `~/.hyper/src/<folder>` must be classified: loading, the code index, access
 * checks in /rpc. Returns null for platform modules (system level) and for names that are none of the three.
 * User ids may contain dots and dashes (`m.rijikov`), which a module name cannot, so a user's module is
 * `user_` + the id with every character other than a letter or digit replaced by `_`: `user_m_rijikov` is the
 * module of `m.rijikov` (memory.userModule builds it).
 * @param opts.module Module (first segment of a dotted name, or a folder under ~/.hyper/src), e.g. `project_hyperDesign`.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Module (first segment of a dotted name, or a folder under ~/.hyper/src), e.g. `project_hyperDesign`. */
        module: string;
    },
): Promise<{ level: "user" | "project" | "agent"; owner: string } | null> {
    const m = String(opts.module ?? "");
    const project = /^project_([a-z][A-Za-z0-9]{0,62})$/.exec(m);
    if (project) return { level: "project", owner: project[1]! };
    const agent = /^agent_([a-z0-9]{1,16})$/.exec(m);
    if (agent) return { level: "agent", owner: agent[1]! };
    const user = /^user_([A-Za-z0-9_]{1,64})$/.exec(m);
    if (user) {
        const rows: any[] = await ctx.fns.procs.db.select({ sql: "select id from users where regexp_replace(id, '[^A-Za-z0-9]', '_', 'g') = ?", params: [user[1]] });
        return rows[0] ? { level: "user", owner: String(rows[0].id) } : null;
    }
    return null;
}
