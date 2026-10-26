/**
 * Shows the memory entries you can see as a table page, each row a link to memory.view.
 *
 * Use as the table of contents of memory in the browser or on the canvas: `/rpc/memory.table` (everything),
 * `/rpc/memory.table?{"prefix":"todo/"}` (records under a prefix), `?{"kind":"decision"}`. Same filters as
 * memory.list, visible levels per memory.visible (an agent: its four levels; a person: their own, projects, their
 * agents). Records show their `status` when their data has one.
 * @view
 * @live memory
 * @param opts.prefix Only keys starting with this prefix, e.g. notes/ or todo/.
 * @param opts.kind Only entries of this free-form kind.
 * @param opts.visibility Only entries of this level.
 * @param opts.type Only entries of this storage type.
 * @param opts.limit Maximum rows. @default 200 @minimum 1 @maximum 1000
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Only keys starting with this prefix, e.g. notes/ or todo/. */
    prefix?: string;
    /** Only entries of this free-form kind. */
    kind?: string;
    /** Only entries of this level. */
    visibility?: "agent" | "project" | "user" | "system";
    /** Only entries of this storage type. */
    type?: "file" | "code" | "jsonb";
    /** Maximum rows. @default 200 @minimum 1 @maximum 1000 */
    limit?: number;
}): Promise<string> {
    const v = await ctx.fns.memory.visible({});
    const where = [v.sql];
    const params: any[] = [...v.params];
    if (opts.prefix) { where.push("key like ?"); params.push(String(opts.prefix).replace(/[%_\\]/g, (c: string) => "\\" + c) + "%"); }
    if (opts.kind) { where.push("kind = ?"); params.push(String(opts.kind)); }
    if (opts.visibility) { where.push("visibility = ?"); params.push(String(opts.visibility)); }
    if (opts.type) { where.push("type = ?"); params.push(String(opts.type)); }
    params.push(Math.min(Math.max(Number(opts.limit ?? 200) || 200, 1), 1000));
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `select id, visibility, type, kind, key, title, description, data->>'status' as status, meta->>'status' as fn_status, updated_at
              from memory where ${where.join(" and ")} order by key, ${v.order} limit ?`,
        params,
    });
    const esc = (text: string) => ctx.fns.w.escape({ text });
    const view = (r: any) => ctx.fns.rpc.url({ fn: "memory.view", params: { id: Number(r.id) } });
    const filter = (p: Record<string, unknown>) => ctx.fns.rpc.url({ fn: "memory.table", params: p });
    const prefixes = [...new Set(rows.map(r => String(r.key).split("/")[0] + "/"))];
    const w = ctx.fns.w;
    // The prefixes as one quiet row of links (plain: a canvas tab follows its own links).
    const nav = w.box({ body: [`<a class="w-link" href="${esc(filter({}))}">all</a>`, ...prefixes.map(p => `<a class="w-link" href="${esc(filter({ prefix: p }))}">${esc(p)}</a>`)].join(" · "), mix: { text: "small", ink: "faint" } });
    const title = [opts.prefix, opts.kind, opts.visibility, opts.type].filter(Boolean).join(" · ") || "all";
    const head = w.heading({ title: `Memory: ${title}`, meta: nav });
    if (!rows.length) return w.box({ body: head + w.empty({ title: "Nothing here", icon: "tray" }), mix: { layout: "stack", gap: "s4" } });
    const table = w.table({
        columns: [{ key: "key" }, { key: "title" }, { key: "status" }, { key: "kind" }, { key: "level" }, { key: "updated" }],
        rows: rows.map(r => ({
            key: { html: `<a class="w-link" href="${esc(view(r))}">${esc(r.key)}</a>` },
            title: { html: esc(r.title ?? "") + (r.description ? w.box({ body: esc(String(r.description).slice(0, 200)), mix: { text: "small", ink: "faint" } }) : "") },
            status: r.status ?? r.fn_status ?? "",
            kind: r.kind ?? "",
            level: r.visibility,
            updated: new Date(Number(r.updated_at)).toISOString().slice(0, 10),
        })),
    });
    return w.box({ body: head + table, mix: { layout: "stack", gap: "s4" } });
}
