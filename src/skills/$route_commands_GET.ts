/** Returns the skills a person can start with /name in one agent's chat, as JSON for the composer's suggestions; empty when that agent has no `skill` tool. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const json = (rows: unknown) => Response.json(rows, { headers: { "cache-control": "no-store" } });
    const id = new URL(opts.req.url).searchParams.get("agent") ?? "";
    const agent = id ? (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id }).catch(() => null) : null;
    if (!agent || !ctx.fns.skills.enabledFor({ agent })) return json([]);
    const skills = await ctx.fns.skills.list({ invocation: "user", limit: 2000 });
    const counts = new Map<string, number>();
    for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    return json(skills.map(skill => ({
        name: (counts.get(skill.name) ?? 0) > 1 ? skill.id : skill.name,
        pack: skill.pack,
        description: skill.description.slice(0, 200),
        hint: skill.argumentHint,
    })));
}
