/**
 * Lists the Agent Skills this instance knows: installed packs and skills of the shared folders
 *
 * Use to see what is available before loading one with the `skill` tool or skills.use, to show a pack's contents, or
 * to find skills only a person can start. Reads the index (skills.index keeps it current); the instructions are not
 * returned — skills.use loads them. `invocation: "model"` keeps skills the model may start itself (the skill allows it
 * and its pack is allowed to the model); `"user"` keeps those reachable with /name.
 * @param opts.pack Only skills of this pack; `local` is the shared folders.
 * @param opts.invocation Only skills the model may start itself, or only those a person can start with /name.
 * @param opts.query Case-insensitive substring of the name or description.
 * @param opts.exact Only the skill with this full name (`pack:name`), or every skill with this short name.
 * @param opts.ids Only these full names.
 * @param opts.limit Maximum rows. @default 500 @minimum 1 @maximum 2000
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only skills of this pack; `local` is the shared folders. */
    pack?: string;
    /** Only skills the model may start itself, or only those a person can start with /name. */
    invocation?: "model" | "user";
    /** Case-insensitive substring of the name or description. */
    query?: string;
    /** Only the skill with this full name (`pack:name`), or every skill with this short name. */
    exact?: string;
    /** Only these full names. */
    ids?: string[];
    /** Maximum rows. @default 500 @minimum 1 @maximum 2000 */
    limit?: number;
} = {}): Promise<types.skills.Skill[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.pack) { where.push("pack = ?"); params.push(opts.pack); }
    if (opts.invocation === "model") where.push("model_invocable AND model_allowed");
    if (opts.invocation === "user") where.push("user_invocable");
    if (opts.query?.trim()) { where.push("(name ILIKE ? OR description ILIKE ?)"); const q = `%${opts.query.trim().replace(/[%_\\]/g, "\\$&")}%`; params.push(q, q); }
    if (opts.exact) { where.push("(id = ? OR name = ?)"); params.push(opts.exact, opts.exact); }
    if (opts.ids) { if (!opts.ids.length) return []; where.push(`id IN (${opts.ids.map(() => "?").join(",")})`); params.push(...opts.ids); }
    const limit = Math.max(1, Math.min(2000, Math.floor(Number(opts.limit ?? 500)) || 500));
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT * FROM skill_docs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name, pack LIMIT ${limit}`, params }) as any[];
    const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value ?? [];
    return rows.map(row => ({
        id: String(row.id), name: String(row.name), pack: String(row.pack), source: row.source === "root" ? "root" : "pack", trust: String(row.trust),
        modelAllowed: Boolean(row.model_allowed), description: String(row.description), dir: String(row.dir),
        modelInvocable: Boolean(row.model_invocable), userInvocable: Boolean(row.user_invocable), argumentHint: row.argument_hint ?? null,
        files: json(row.files) as string[], diagnostics: json(row.diagnostics) as string[], bodyChars: Number(row.body_chars), contentHash: String(row.content_hash),
    }));
}
