/**
 * Tells whether an agent has the `skill` tool, which is what turns Agent Skills on for it
 *
 * Use before sending an agent the skill list or expanding /name in its chat: an agent that cannot load a skill must
 * not be told about skills. The tool is opt-in while skills are being rolled out, so by default only agents that name
 * `skill` in their tool list have it; once the declaration drops `optIn`, every agent without a narrowed tool list
 * does.
 * @param opts.agent Agent to check.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent to check. */
    agent: types.agent.Agent;
}): boolean {
    const tool = (ctx.fns.tools.list({}) as any[]).find(t => t.key === "skills.skill");
    if (!tool) return false;
    const only: string[] = Array.isArray(opts.agent?.tools) ? opts.agent.tools! : [];
    if (only.length) return only.includes(tool.wireName) || only.includes(tool.name);
    return !tool.optIn;
}
