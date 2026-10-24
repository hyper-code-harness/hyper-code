/**
 * Opens something on an agent's canvas as a new active tab and shows the canvas.
 *
 * Use to put a file, a document or any other catalog kind (canvas.kinds) in front of the person, beside
 * the chat. The kind checks and normalises its args; the tab persists with the agent across reloads, and
 * every open page of that chat follows at once. Showing the same kind with the same args again just
 * switches to the existing tab — or brings it back if it was closed, with its state. An `html` page without
 * scripts or `load` is saved to memory as `pages/<slug of the title>.html` (project level, or the
 * agent's without a project) and opened as a `view` tab at `/rpc/memory.view?{"key":…}`, so it has an address;
 * showing a page with the same title again updates that page and its tab. A `file` opens as a `view` tab of
 * `files.page` (path pinned absolute in the agent's workspace), and a kind that names a `view` (plugin kinds such
 * as architectureMap.map, code.tests, gcal.calendar, icons.browser) opens a `view` tab of that function.
 * The answer is the tab plus `address` (its `/rpc/…` address when it has one), `reused` (the same thing was
 * already a tab), `fixed` (what the server corrected on the way) and `hint` (advice, nothing changed). An html page
 * whose only scripts draw Mermaid diagrams is drawn on the server instead (mermaid.render) and saved as a static
 * page — `fixed` says so.
 * @param opts.kind Canvas kind from the catalog, e.g. file; omit to let args decide.
 * @param opts.args Arguments of that kind, e.g. { path } for file.
 * @param opts.title Tab title; defaults to the kind's suggestion.
 * @param opts.agentId Agent whose canvas to use. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Canvas kind from the catalog, e.g. file; omit to let args decide: `path` → file, `fn` or a `/rpc/…` url → view, `html` → html, an http(s) `url` → url. */
    kind?: string;
    /** Arguments of that kind, e.g. { path } for file. */
    args?: Record<string, any>;
    /** Tab title; defaults to the kind's suggestion. */
    title?: string;
    /** Agent whose canvas to use. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Shown> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const args = opts.args ?? {};
    const kindName = opts.kind || inferKind(args);
    if (!kindName) throw new Error("canvas.show: give kind, or args with path, fn, url or html");
    if (kindName !== opts.kind) return ctx.fns.canvas.show({ ...opts, agentId, kind: kindName });
    let fixed: string | undefined;
    let hint: string | undefined;
    if (opts.kind === "file" && /(^|\/)\.hyper\/tmp\//.test(String(args.path ?? ""))) hint = "this file is in .hyper/tmp, which is temporary — if it is a document for the person, show it as html (it is saved to memory with an address)";
    // Mermaid drawn in the browser (a CDN script) makes a page a framed snapshot without an address; drawn here it
    // stays a static page in memory, themed and linkable.
    if (opts.kind === "html" && typeof args.html === "string" && !args.load && /<script\b/i.test(args.html)) {
        const drawn = await serverMermaid(ctx, args.html);
        if (drawn.html !== null) {
            fixed = `mermaid drawn on the server (${drawn.count} diagram${drawn.count === 1 ? "" : "s"}); the page is static and saved to memory — next time call mermaid.render({ source }) and paste the svg`;
            const shown = await ctx.fns.canvas.show({ ...opts, agentId, args: { ...args, html: drawn.html } });
            return { ...shown, fixed };
        }
        if (drawn.count) hint = "this page draws Mermaid in the browser next to other scripts, so it stays a framed snapshot without an address — draw diagrams with mermaid.render({ source }) and keep scripts only for real interaction";
    }
    // A static html page is a document with an address: it is saved to memory (pages/<slug>.html — the
    // project's level, or the agent's without a project) and opened as a view tab, /rpc/memory.view?{key}.
    // A page with scripts (an animation, the `hyper.*` page API) or server `load` data stays an html tab: a view
    // shows memory pages without their scripts (rpc.cleanHtml).
    if (opts.kind === "html" && typeof opts.args?.html === "string" && opts.args.html.trim() && !opts.args.load && !/<script\b|\son[a-z]+\s*=/i.test(opts.args.html)) {
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
        const updated = page.version > 1 ? await ctx.fns.canvas.setState({ agentId, itemId: item.id, state: { page: page.version } }) : item;
        return { ...updated, address: item.address, reused: item.reused, ...(fixed ? { fixed } : {}) };
    }
    // A file is an address too: the file kind pins the path (absolute, in the target agent's workspace, with
    // its host) and the tab is a view of files.page — address bar, history, open in a browser tab.
    if (opts.kind === "file") {
        const fileKind = ((ctx.state as any).canvas?.kinds ?? {}).file as types.canvas.Registered | undefined;
        if (!fileKind?.prepare) throw new Error("canvas.show: the file kind is not loaded");
        const pinned = await fileKind.prepare(ctx, { agentId, args: opts.args ?? {} });
        const a = pinned.args;
        const params = { path: a.path, ...(a.host && a.host !== "local" ? { host: a.host } : {}), ...(a.tab ? { tab: a.tab } : {}) };
        const shown = await ctx.fns.canvas.show({ agentId, kind: "view", title: opts.title ?? pinned.title, args: { fn: "files.page", params } });
        return hint ? { ...shown, hint } : shown;
    }
    const kind = ((ctx.state as any).canvas?.kinds ?? {})[opts.kind] as types.canvas.Registered | undefined;
    if (!kind) throw new Error(`canvas.show: unknown kind "${opts.kind}" — loaded: ${(await ctx.fns.canvas.kinds({})).map(k => k.name).join(", ") || "none"}`);
    const prepared = kind.prepare ? await kind.prepare(ctx, { agentId, args: opts.args ?? {} }) : { args: opts.args ?? {} };
    // A kind that is an alias of a `@view` opens that view: the tab gets the view's address and history.
    if (kind.view) return ctx.fns.canvas.show({ agentId, kind: "view", title: opts.title ?? prepared.title, args: { fn: kind.view, params: prepared.args ?? {} } });
    const title = String(opts.title ?? prepared.title ?? opts.kind).slice(0, 200);
    const payload = JSON.stringify(prepared.args ?? {});

    // Lookup and insert under the agent's canvas lock: two identical shows make one tab.
    const { id, reused } = (await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const same = (await ctx.fns.procs.db.select({ sql: "SELECT id, closed_at FROM canvas_items WHERE agent_id = ? AND kind = ? AND payload = ?::jsonb ORDER BY closed_at IS NOT NULL, closed_at DESC, id LIMIT 1", params: [agentId, opts.kind, payload] })) as any[];
            const now = Date.now();
            let itemId: number;
            const reused = !!same[0];
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
            return { id: itemId, reused };
        },
    })) as { id: number; reused: boolean };
    const item = (await ctx.fns.canvas.list({ agentId })).find(i => i.id === id)!;
    const address = opts.kind === "view" && typeof item.args.url === "string" ? item.args.url : opts.kind === "url" ? String(item.args.url ?? "") : undefined;
    return { ...item, ...(address ? { address } : {}), reused, ...(fixed ? { fixed } : {}), ...(hint ? { hint } : {}) };
}

/** The kind args point at when no kind is given. */
function inferKind(args: Record<string, any>): string | null {
    if (typeof args.html === "string") return "html";
    if (typeof args.fn === "string") return "view";
    if (typeof args.path === "string") return "file";
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (/^\/rpc\//.test(url)) return "view";
    if (/^https?:\/\//i.test(url)) return "url";
    return null;
}

const MERMAID_BLOCK = /<(pre|div)\b([^>]*\bclass\s*=\s*["'][^"']*\bmermaid\b[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi;
const decode = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");

/**
 * Draws the Mermaid diagrams of a page on the server when its scripts do nothing else. Returns the page without
 * scripts and with svg in place of each diagram, or html null when it must stay as it is (other scripts, inline
 * handlers, no mermaid plugin, a diagram that fails) — count then says how many diagrams it saw.
 */
async function serverMermaid(ctx: Context, html: string): Promise<{ html: string | null; count: number }> {
    const blocks = [...html.matchAll(MERMAID_BLOCK)];
    if (!blocks.length) return { html: null, count: 0 };
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const onlyMermaid = scripts.every(([, attrs, body]) => /mermaid/i.test(attrs!) || (/mermaid/i.test(body!) && !/\b(fetch|addEventListener|setInterval|setTimeout|hyper\.|document\.(?!querySelectorAll\(['"]\.mermaid))/.test(body!) && body!.length < 600));
    const render = (ctx.fns as any).mermaid?.render as ((o: { source: string }) => Promise<string>) | undefined;
    if (!onlyMermaid || /\son[a-z]+\s*=/i.test(html) || !render) return { html: null, count: blocks.length };
    let out = html;
    for (const [whole, , , source] of blocks) {
        let svg: string;
        try { svg = await render({ source: decode(source!).trim() }); } catch { return { html: null, count: blocks.length }; }
        out = out.replace(whole, svg);
    }
    return { html: out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<script\b[^>]*\/>/gi, ""), count: blocks.length };
}
