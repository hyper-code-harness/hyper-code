/** Delegate task for the runtime.  * @param opts.parent Parent agent that delegates the task.
 * @param opts.task Concise task to assign or perform.
 * @param opts.forkContext Whether the child inherits parent transcript context.
 * @param opts.instructions Additional instructions for completing the task.
 * @param opts.mode Delegation execution mode.
 * @param opts.responseFormat Expected completed-task response format.
 * @param opts.autoArchive Whether to archive the child after completion.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
/**
 * Delegate a task to a child agent.
 * In "await" mode, blocks until the child calls finishTask.
 * In "async" mode, spawns the child and returns immediately.
 */
    opts: {

        /** Parent agent delegating the task. */
        parent: types.agent.Agent;

        /** Task instructions. */
        task: string;

        /** Whether to inherit the parent transcript. */
        forkContext?: boolean;

        /** Instructions used by the operation. */
        instructions?: string;

        /** Operation mode. */
        mode?: "await" | "async";

        /** Response format used by the operation. */
        responseFormat?: "text" | "json" | "report" | { kind: "report" | "json"; fields?: string[] };

        /** Auto archive used by the operation. */
        autoArchive?: boolean;
    },
): Promise<{ childId: string; summary?: string; result?: any; started?: true }> {
    const parentAgent = opts.parent;
    const task = String(opts?.task ?? "").trim();
    if (!task) throw new Error("delegateTask: task is required");
    const mode = opts?.mode === "async" ? "async" : "await";
    const forkContext = !!opts?.forkContext;
    const instructions = String(opts?.instructions ?? "").trim();
    const responseFormat = opts?.responseFormat ?? "text";
    const autoArchive = opts.autoArchive !== false;

    const child = forkContext
        ? await ctx.fns.session.fork({ id: parentAgent.id, visibility: "team" })
        : await ctx.fns.agent.start({
            model: parentAgent.model,
            systemPrompt: parentAgent.systemPrompt,
            // A delegated child works where its parent works.
            workspaceDir: parentAgent.workspaceDir,
            workspaceHost: parentAgent.workspaceHost,
            visibility: "team",
        });

    child.scratchpad ??= {};
    child.scratchpad.delegateTask = {
        parentId: parentAgent.id,
        mode,
        forkContext,
        task,
        instructions,
        responseFormat,
        autoArchive,
        status: "running",
    };
    await ctx.fns.session.save({ agent: child });
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
    await ctx.fns.session.syncAgentState?.({ agent: child });

    const prompt = ctx.fns.agent.buildDelegatedTaskPrompt({ task, instructions, responseFormat });

    if (mode === "async") {
        void ctx.fns.agent.run({ agent: child, userText: prompt })
            .then(async () => {
                if (autoArchive && child.scratchpad?.delegateTask?.status === "finished") {
                    await ctx.fns.session.archive({ id: child.id });
                }
            })
            .catch((error: any) => console.error(`delegateTask async child ${child.id} failed:`, error));
        return { childId: child.id, started: true };
    }

    const waiters = (((ctx.state as any).delegateTaskWaiters) ??= new Map());
    const waiter = new Promise<{ childId: string; summary: string; result: any }>((resolve, reject) => {
        waiters.set(child.id, { resolve, reject, parentId: parentAgent.id, createdAt: Date.now() });
    });

    try {
        await ctx.fns.agent.run({ agent: child, userText: prompt });
        const meta = child.scratchpad?.delegateTask;
        if (meta?.status === "finished" && meta.result) {
            waiters.delete(child.id);
            const response = { childId: child.id, summary: meta.result.summary, result: meta.result.result ?? null };
            if (autoArchive) await ctx.fns.session.archive({ id: child.id });
            return response;
        }
        waiters.delete(child.id);
        throw new Error("delegateTask: child completed without finishTask");
    } catch (error) {
        waiters.delete(child.id);
        console.error(`delegateTask failed for child ${child.id}:`, error);
        throw error;
    }
}
