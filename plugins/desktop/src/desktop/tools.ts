/**
 * Lists Cua Driver tools available through desktop.call, or returns the full description and argument schema of one tool.
 *
 * Use when a needed action has no typed desktop.* wrapper (drag, zoom, invoke_menu, clipboard_read/write, double_click, set_window_frame, recording).
 * @param opts.name Tool name to describe; omit to list all tools with one-line summaries.
 * @param opts.host SSH host alias of a remote Mac; omit for this machine. @default local
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Tool name to describe; omit to list all tools with one-line summaries. */
        name?: string;
        /** SSH host alias of a remote Mac; omit for this machine. @default local */
        host?: string;
    },
): Promise<Array<{ name: string; summary: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    await ctx.fns.desktop.call({ host: opts.host, tool: "get_config", allowError: true });
    const pool: Map<string, any> = (globalThis as any).__desktopCuaPool;
    const conn = pool.get(opts.host || "local");
    if (!conn) throw new Error("desktop.tools: no connection");
    const r = await conn.send("tools/list", {}, 30000);
    const tools = (r?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    const first = (d?: string) => ((d ?? "").split(/(?<=\.)\s|\n/)[0] ?? "").slice(0, 200);
    if (opts.name) {
        const t = tools.find(x => x.name === opts.name);
        if (!t) throw new Error(`desktop.tools: no tool ${opts.name}`);
        return [{ name: t.name, summary: first(t.description), description: t.description, inputSchema: t.inputSchema }];
    }
    return tools.map(t => ({ name: t.name, summary: first(t.description) }));
}
