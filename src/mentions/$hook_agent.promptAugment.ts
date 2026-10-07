// Tells the agent who it can @mention. Only on a shared Hyper (two or more people); the block is identical
// turn to turn, so agent.syncWorldState sends it once and again only when the people change.
/** Answers agent.promptAugment with the people the agent can address with @id in its reply.
 * @param opts.agentId Agent whose turn is being prepared.
 * @param opts.text Latest user message, verbatim.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn is being prepared. */
    agentId: string;
    /** Latest user message, verbatim. */
    text: string;
}): Promise<string> {
    const people = await ctx.fns.mentions.people({});
    if (people.length < 2) return "";
    return "## People you can mention\n\nWrite @id in your reply to address a person; they get an unread mention.\n"
        + people.map((p) => `- @${p.id} — ${p.name}${p.email ? ` <${p.email}>` : ""}`).join("\n");
}
