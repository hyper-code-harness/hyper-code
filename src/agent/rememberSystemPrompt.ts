/**
 * Records a person's last chosen system prompt and reads it back.
 *
 * The New agent form preselects this name for the person; it is stored as the per-user setting
 * agent.lastSystemPrompt. Pass `name` to record, omit it to read. Returns the stored name or null.
 * @param opts.userId Person whose choice is stored or read.
 * @param opts.name Name to record; omit to read the last one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Person whose choice is stored or read. */
    userId: string;
    /** Name to record; omit to read the last one. */
    name?: string;
}): Promise<string | null> {
    const where = { module: "agent", scopeType: "user", scopeId: String(opts.userId), key: "lastSystemPrompt" };
    if (opts.name !== undefined) {
        await ctx.fns.settings.set({ ...where, value: String(opts.name) });
        return String(opts.name);
    }
    const value = await ctx.fns.settings.get(where);
    return typeof value === "string" && value ? value : null;
}
