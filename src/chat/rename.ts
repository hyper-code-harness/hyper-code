/**
 * Renames a chat from the rename popup and reloads the page so the header, Dock and lists show the new name.
 * @param opts.agentId Agent to rename.
 * @param opts.title New name; empty shows the id.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent to rename. */
    agentId: string;
    /** New name; empty shows the id. */
    title?: string;
}): Promise<Response> {
    await ctx.fns.session.setTitle({ id: String(opts.agentId), title: String(opts.title ?? "") });
    return new Response("", { status: 200, headers: { "HX-Refresh": "true" } });
}
