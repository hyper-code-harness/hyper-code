// Tells an agent the concrete shape of its memory: which person, project and folders, how much is there and
// which functions it can call. The rules (what goes where) are in the core system prompt; this block is only
// the facts. It changes when counts or functions change, so agent.syncWorldState sends it again only then.
export default async function (ctx: Context, _session: Session | null, opts: {
    agentId: string;
    text: string;
}): Promise<string> {
    const s = await ctx.fns.memory.scope({ agentId: opts.agentId });
    const counts: any[] = await ctx.fns.procs.db.select({
        sql: `select visibility, count(*)::int as n, count(*) filter (where key = 'notes/where-we-stopped.md')::int as stopped
              from memory where ${s.visibleSql} and type <> 'code' group by visibility`,
        params: s.visibleParams,
    });
    const n = (v: string) => counts.find(c => c.visibility === v)?.n ?? 0;
    const stopped = counts.some(c => c.stopped > 0);
    const fns: any[] = await ctx.fns.procs.db.select({
        sql: `select meta->>'name' as name, description, coalesce(meta->>'status', 'draft') as status, visibility
              from memory where ${s.visibleSql} and type = 'code' and key like 'fn/%'
                and (visibility = 'agent' or meta->>'status' = 'ready')
              order by ${s.order}, key limit 40`,
        params: s.visibleParams,
    });
    const home = s.home.replace(String(ctx.env.HOME ?? "\0"), "~");
    const short = (d: string | null) => d ? d.replace(String(ctx.env.HOME ?? "\0"), "~") + "/" : "—";
    const userModule = s.userId ? await ctx.fns.memory.userModule({ userId: s.userId }) : null;
    const lines = ["## Your memory", ""];
    lines.push(`- agent ${s.agentId}: ${n("agent")} entries in ${short(s.agentDir)}, functions ${home}/src/agent_${s.agentId}/`);
    if (s.projectId) lines.push(`- project ${s.projectSlug} (id ${s.projectId}): ${n("project")} entries in ${short(s.projectDir)}, functions ${home}/src/project_${s.projectSlug}/`);
    else lines.push(`- project: none (project.list({}) shows the projects; project memory needs one)`);
    if (s.userId) lines.push(`- user ${s.userId} (your person, all their agents): ${n("user")} entries in ${short(s.userDir)}, functions ${home}/src/${userModule}/`);
    lines.push(`- system: ${n("system")} entries in ${home}/memory/ (everyone's; written only on the instance owner's request)`);
    if (stopped) lines.push(`- after a compaction or a fresh start read notes/where-we-stopped.md first: memory.file({ ref: "notes/where-we-stopped.md" })`);
    if (fns.length) {
        lines.push(`- functions you can call (ready ones, plus all of yours):`);
        for (const f of fns) lines.push(`  - ctx.fns.${f.name} — ${String(f.description ?? "").slice(0, 140)}${f.visibility === "agent" ? ` (yours, ${f.status})` : ""}`);
    }
    return lines.join("\n");
}
