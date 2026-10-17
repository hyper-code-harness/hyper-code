/**
 * Opens something on an agent's canvas as a new active tab and shows the canvas.
 *
 * Use to put a file, a document or any other catalog kind (canvas.kinds) in front of the person, beside
 * the chat. The kind checks and normalises its args; the tab persists with the agent across reloads, and
 * every open page of that chat follows at once. Showing the same kind with the same args again just
 * switches to the existing tab — or brings it back if it was closed, with its state. A static `html` page (no
 * `load`, no `hyper.*` page API) is saved to memory as `pages/<slug of the title>.html` (project level, or the
 * agent's without a project) and opened as a `view` tab at `/rpc/memory.view?{"key":…}`, so it has an address;
 * showing a page with the same title again updates that page and its tab.
 * @param opts.kind Canvas kind from the catalog, e.g. file.
 * @param opts.args Arguments of that kind, e.g. { path } for file.
 * @param opts.title Tab title; defaults to the kind's suggestion.
 * @param opts.agentId Agent whose canvas to use. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Canvas kind from the catalog, e.g. file. */
    kind: string;
    /** Arguments of that kind, e.g. { path } for file. */
    args?: Record<string, any>;
    /** Tab title; defaults to the kind's suggestion. */
    title?: string;
    /** Agent whose canvas to use. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    // A static html page is a document with an address: it is saved to memory (pages/<slug>.html — the
    // project's level, or the agent's without a project) and opened as a view tab, /rpc/memory.view?{key}.
    // Pages with server `load` data or the `hyper.*` page API stay html tabs — they need the html frame bridge.
    if (opts.kind === "html" && typeof opts.args?.html === "string" && opts.args.html.trim() && !opts.args.load && !/\bhyper\s*\.\s*(state|setState|onState|ping|data)\b/.test(opts.args.html)) {
        const html: string = opts.args.html;
        const title = String(opts.title ?? html.match(/<title>([^<]{1,120})<\/title>/i)?.[1]?.trim() ?? "Page").slice(0, 200);
        const slug = title.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60)
            || Bun.hash(html).toString(36);
        const scope = await ctx.fns.memory.scope({ agentId });
        const asAgent: any = Object.create(ctx);
        asAgent.session = { kind: "agent", agentId };
        const page = await asAgent.fns.memory.write({ path: `pages/${slug}.html`, content: html, title, description: `Canvas page «${title}»`, kind: "page", visibility: scope.projectId ? "project" : "agent" });
        const item = await ctx.fns.canvas.show({ agentId, kind: "view", title, args: { fn: "memory.view", params: { key: page.key } } });
        // Same address, new content: a new page version in the tab state re-renders the frame.
        return page.version > 1 ? await ctx.fns.canvas.setState({ agentId, itemId: item.id, state: { page: page.version } }) : item;
    }
    const kind = ((ctx.state as any).canvas?.kinds ?? {})[opts.kind] as types.canvas.Registered | undefined;
    if (!kind) throw new Error(`canvas.show: unknown kind "${opts.kind}" — loaded: ${(await ctx.fns.canvas.kinds({})).map(k => k.name).join(", ") || "none"}`);
    const prepared = kind.prepare ? await kind.prepare(ctx, { agentId, args: opts.args ?? {} }) : { args: opts.args ?? {} };
    const title = String(opts.title ?? prepared.title ?? opts.kind).slice(0, 200);
    const payload = JSON.stringify(prepared.args ?? {});

    // Lookup and insert under the agent's canvas lock: two identical shows make one tab.
    const id = (await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const same = (await ctx.fns.procs.db.select({ sql: "SELECT id, closed_at FROM canvas_items WHERE agent_id = ? AND kind = ? AND payload = ?::jsonb ORDER BY closed_at IS NOT NULL, closed_at DESC, id LIMIT 1", params: [agentId, opts.kind, payload] })) as any[];
            const now = Date.now();
            let itemId: number;
            if (same[0]) {
                itemId = Number(same[0].id);
                if (opts.title) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET title = ?, updated_at = ? WHERE id = ?", params: [title, now, itemId] });
                // A closed tab with the same thing comes back with its state, at the end of the strip.
                if (same[0].closed_at != null) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET closed_at = NULL, updated_at = ?, position = (SELECT COALESCE(MIN(position), 1) - 1 FROM canvas_items WHERE agent_id = ? AND closed_at IS NULL) WHERE id = ?", params: [now, agentId, itemId] });
            } else {
                const pos = (await ctx.fns.procs.db.select({ sql: "SELECT COALESCE(MIN(position), 1) - 1 AS p FROM canvas_items WHERE agent_id = ? AND closed_at IS NULL", params: [agentId] })) as any[];
                const row: any = await ctx.fns.procs.db.insert({ into: "canvas_items", values: { agent_id: agentId, kind: opts.kind, title, payload, position: Number(pos[0]?.p ?? 0), created_at: now, updated_at: now } });
                itemId = Number(row.id);
            }
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
            return itemId;
        },
    })) as number;
    return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === id)!;
}
