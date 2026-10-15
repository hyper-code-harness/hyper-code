/**
 * Set a chat icon from the local Lucide catalogue with consistent padding
 *
 * Install a known Lucide name on the calling chat or an explicitly selected chat. Uses icons.get for standard padding and chat.setIcon for sanitization and persistence; no network request.
 * @param opts.name Exact Lucide name returned by icons.search.
 * @param opts.id Target chat identifier; omitted targets the calling agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact Lucide name returned by icons.search. */
        name: string;
        /** Target chat identifier; omitted targets the calling agent. */
        id?: string;
    },
): Promise<{ id: string; name: string; icon: string | null }> {
    const { svg } = await ctx.fns.icons.get({ name: opts.name, padded: true });
    const result = await ctx.fns.chat.setIcon({ id: opts.id, svg });
    return { ...result, name: opts.name };
}
