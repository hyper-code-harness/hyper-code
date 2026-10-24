/**
 * Lists the memory-level function modules (`user_<id>`, `project_<slug>`, `agent_<id>`) the caller may not run.
 *
 * Use to leave functions of another person, project or agent out of a listing or search before its limit —
 * runtime.docs.search and runtime.docs.tags do. Decided per module by project.canCall for the session's agent
 * and person; platform and plugin modules are never hidden. The function index itself stays global.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string[]> {
    const heads = new Set<string>();
    for (const item of ctx.fns.runtime.docs.list({})) {
        const head = item.name.split(".")[0] ?? "";
        if (/^(user|project|agent)_/.test(head)) heads.add(head);
    }
    const hidden: string[] = [];
    for (const head of [...heads].sort()) {
        const verdict = await ctx.fns.project.canCall({ name: head + ".x" }).catch(() => ({ allowed: false }));
        if (!verdict.allowed) hidden.push(head);
    }
    return hidden;
}
