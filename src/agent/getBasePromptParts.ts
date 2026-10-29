/**
 * Returns the base system prompt text shown in the New agent form, by name.
 * @param opts.name Name of the system prompt (agent.systemPrompts). @default "full"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Name of the system prompt (agent.systemPrompts). @default "full" */
    name?: string;
} = {}) {
    const name = String(opts?.name ?? "").trim() || "full";
    const found = (await ctx.fns.agent.systemPrompts({ name }))[0] ?? (await ctx.fns.agent.systemPrompts({ name: "full" }))[0];
    // The wire prompt described the markers protocol; native tool calls made it obsolete. Empty is the honest value.
    return { core: found?.text ?? "", wire: "" };
}
