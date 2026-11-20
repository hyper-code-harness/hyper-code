/**
 * Run a single delegated task with an optional child model and reasoning preference.
 *
 * Use await mode to return the child's finishTask result, or async mode to return
 * its ID immediately. Validate the model route and thinking preference before
 * creating a child. Omitted settings inherit the parent's model and requested
 * reasoning effort; older parents without a preference use auto.
 * @param opts.parent Parent agent delegating the task.
 * @param opts.task Non-empty task instructions.
 * @param opts.model Child model route accepted by llm.resolveEndpoint; omitted inherits the parent model.
 * @param opts.reasoningEffort Requested child thinking level; omitted inherits the parent preference.
 * @param opts.forkContext Inherit the parent transcript rather than start an isolated session. @default false
 * @param opts.instructions Additional constraints appended to the task prompt.
 * @param opts.mode Wait for completion or return the child ID immediately. @default await
 * @param opts.responseFormat Desired format of the child's finishTask result. @default text
 * @param opts.autoArchive Archive the child after successful completion. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {

        /** Parent agent delegating the task. */
        parent: types.agent.Agent;

        /** Task instructions. */
        task: string;

        /** Child model route accepted by llm.resolveEndpoint; omitted inherits the parent model. */
        model?: string;

        /** Requested child thinking level; omitted inherits the parent preference, or auto for older parents. */
        reasoningEffort?: types.llm.ReasoningEffort;

        /** Inherit the parent transcript rather than start an isolated session. @default false */
        forkContext?: boolean;

        /** Additional constraints appended to the task prompt. */
        instructions?: string;

        /** Wait for completion or return the child ID immediately. @default await */
        mode?: "await" | "async";

        /** Desired format of the child's finishTask result. @default text */
        responseFormat?: "text" | "json" | "report" | { kind: "report" | "json"; fields?: string[] };

        /** Archive the child after successful completion. @default true */
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

    const settings = await ctx.fns.agent.resolveDelegationSettings({ parent: parentAgent, model: opts.model, reasoningEffort: opts.reasoningEffort });
    const child = forkContext
        ? await ctx.fns.session.fork({ id: parentAgent.id, visibility: "team" })
        : await ctx.fns.agent.start({
            model: settings.model,
            systemPrompt: parentAgent.systemPrompt,
            systemPromptName: parentAgent.systemPromptName,
            systemPromptCore: parentAgent.systemPromptCore,
            // A delegated child works where its parent works.
            workspaceDir: parentAgent.workspaceDir,
            workspaceHost: parentAgent.workspaceHost,
            visibility: "team",
        });

    child.model = settings.model;
    child.reasoningEffort = settings.reasoningEffort;
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
