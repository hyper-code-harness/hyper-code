/** Start for the runtime.  * @param opts.model Model identifier to use.
 * @param opts.title Human-readable agent title.
 * @param opts.workspaceDir Workspace directory assigned to the agent; a path on workspaceHost when that is set.
 * @param opts.workspaceHost SSH host alias the workspace lives on; empty or omitted means local.
 * @param opts.systemPrompt Additional system instructions.
 * @param opts.parentId Optional parent agent identifier.
 * @param opts.forkOffset Optional inherited parent transcript offset.
 * @param opts.visibility Listing policy: nav, team, or hidden. @default nav
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
            /** Narrow the agent to these tool wire names; unset means every declared tool. */
    tools?: string[];
    /** Parent id used by the operation. */
    parentId?: string | null;
        /** Listing policy; this does not grant or restrict access. @default nav */
    visibility?: "nav" | "team" | "hidden";
        /** Fork offset used by the operation. */
    forkOffset?: number | null },
): Promise<types.agent.Agent> {
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
        wakeAt: null,
        wakeReason: null,
    };
    (ctx.state as any).agent ??= {};
    (ctx.state as any).agent[id] = agent;
    await ctx.fns.session?.save?.({ agent });
    ctx.fns.events?.emitAgentsChanged?.({ agentId: agent.id, reason: "create" });
    return agent;
}
