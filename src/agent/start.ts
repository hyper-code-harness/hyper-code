/** Start for the runtime.  * @param opts.model Model identifier to use.
 * @param opts.title Human-readable agent title.
 * @param opts.workspaceDir Workspace directory assigned to the agent; a path on workspaceHost when that is set.
 * @param opts.workspaceHost SSH host alias the workspace lives on; empty or omitted means local.
 * @param opts.systemPrompt Additional system instructions.
 * @param opts.systemPromptName Name of the base system prompt (agent.systemPrompts); empty means the default.
 * @param opts.systemPromptCore A one-off base system prompt text used instead of a named one.
 * @param opts.parentId Optional parent agent identifier.
 * @param opts.forkOffset Optional inherited parent transcript offset.
 * @param opts.visibility Listing policy: nav, team, or hidden. @default nav
 * @param opts.projectId Project id or slug to attach the agent to; its defaultDir becomes the workspace unless workspaceDir is given.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Model identifier. */
    model: string;
        /** Human-readable title. */
    title?: string;
        /** Workspace directory; a path on workspaceHost when that is set. */
    workspaceDir?: string;
        /** SSH host alias the workspace lives on; empty or omitted means local. */
    workspaceHost?: string;
        /** Additional system instructions. */
    systemPrompt?: string;
        /** Name of the base system prompt (agent.systemPrompts); empty means the default. */
    systemPromptName?: string;
        /** A one-off base system prompt text used instead of a named one. */
    systemPromptCore?: string;
            /** Narrow the agent to these tool wire names; unset means every declared tool. */
    tools?: string[];
    /** Parent id used by the operation. */
    parentId?: string | null;
        /** Listing policy; this does not grant or restrict access. @default nav */
    visibility?: "nav" | "team" | "hidden";
        /** Fork offset used by the operation. */
    forkOffset?: number | null;
        /** Project id or slug to attach the agent to; its defaultDir becomes the workspace unless workspaceDir is given. */
    projectId?: string | null },
): Promise<types.agent.Agent> {
    const project = opts.projectId
        ? (await ctx.fns.project.get({ id: opts.projectId })) ?? (await ctx.fns.project.get({ slug: opts.projectId }))
        : null;
    if (opts.projectId && !project) throw new Error(`agent.start: unknown project ${opts.projectId}`);
    // A project agent works in the project's folder unless the caller chose a workspace explicitly.
    if (project?.defaultDir && !opts.workspaceDir) opts = { ...opts, workspaceDir: project.defaultDir, workspaceHost: project.defaultHost };
    const id = await ctx.fns.agent.nextId({});
    const workspaceHost = String(opts.workspaceHost ?? "").trim();
    const workspaceDir = workspaceHost && opts.workspaceDir?.startsWith("/")
        ? opts.workspaceDir
        : opts.workspaceDir || workspaceHost
            ? await ctx.fns.workspace.normalize({ dir: opts.workspaceDir, host: workspaceHost })
            : process.cwd();
    const agent: types.agent.Agent = {
        id,
        model: opts.model,
        title: String(opts.title ?? "").trim().slice(0, 120),
        reasoningEffort: "auto",
        workspaceDir,
        workspaceHost,
        systemPrompt: opts.systemPrompt ?? "",
        systemPromptName: String(opts.systemPromptName ?? "").trim(),
        systemPromptCore: String(opts.systemPromptCore ?? ""),
        tools: opts.tools,
        messages: [],
        events: [],
        cursors: {},
        subscribers: new Set(),
        waiters: [],
        isStreaming: false,
        abortController: null,
        scratchpad: {},
        parentId: opts.parentId ?? null,
        statusLine: "",
        visibility: opts.visibility ?? "nav",
        statusLineEvery: 1,
        forkOffset: opts.forkOffset ?? null,
        sleepContext: null,
        currentJobId: null,
        goal: null,
        drainPromise: null,
    };
    (ctx.state as any).agent ??= {};
    (ctx.state as any).agent[id] = agent;
    await ctx.fns.session?.save?.({ agent });
    if (project) await ctx.fns.procs.db.run({ sql: "UPDATE agents SET project_id = ? WHERE id = ?", params: [project.id, id] });
    ctx.fns.events?.emitAgentsChanged?.({ agentId: agent.id, reason: "create" });
    return agent;
}
