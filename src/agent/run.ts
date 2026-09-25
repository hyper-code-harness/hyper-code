// The agent turn loop. Tools are invoked as the provider's NATIVE function
// calls; there is no text protocol to parse, so there is no parse error to
// repair — the provider validated the envelope and ctx.fns.tools.validate
// validated the arguments before anything ran.
//
// One loop, one registry: every call goes through ctx.fns.tools.call over the
// $tool_ declarations, exactly like a call made by hand from the REPL.
//
// The loop ends on a reply with no tool calls — pure prose back to the user.
/**
 * Execute one agent turn through native tool cycles and persist its final response.
 * Use for direct turns or worker-claimed input. Successful prose and terminal HTML
 * responses asynchronously launch optional Knowledge extraction through the final
 * durable assistant index; failed, aborted and observer turns do not launch it.
 * @param opts.agent Live agent whose transcript and turn state are updated.
 * @param opts.userText User input to append unless already persisted by ingestion.
 * @param opts.userMessageAlreadyAppended Skip appending input for worker-claimed messages. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Live agent whose transcript and turn state are updated. */
        agent: types.agent.Agent;
        /** User input to append unless already persisted by ingestion. */
        userText: string;
        /** Skip appending input for worker-claimed messages. @default false */
        userMessageAlreadyAppended?: boolean;
    },
) {
    const { agent, userText } = opts;
    const agentCtx: any = Object.create(ctx);
    agentCtx.session = ctx.fns.session.forAgent({ agent });
    ctx = agentCtx;
    const ac = new AbortController();
    agent.abortController = ac;
    // One successful-turn hook shared by direct and worker runs. The cutoff is
    // the final durable assistant row, never the triggering user frontier or a
    // later MAX(idx) that could capture a concurrently arriving user message.
    const observeCompletedTurn = (messageIdx: number) => {
        if (ac.signal.aborted || agent.scratchpad?.knowledgeTrackingEnabled !== true
            || agent.scratchpad?.knowledgeSidecarFor || agent.scratchpad?.goalSidecarFor) return;
        const knowledge = (ctx.fns as any).knowledge;
        if (typeof knowledge?.updateSidecar !== 'function') return;
        // Do not hold the response/worker cursor open for extraction; absorb both
        // synchronous throws and rejected promises from the optional plugin.
        void Promise.resolve().then(() => knowledge.updateSidecar({ agent, messageIdx })).catch(() => undefined);
    };

    if (!opts.userMessageAlreadyAppended) {
        await ctx.fns.session.appendUserMessage({ id: agent.id, text: userText });
        await ctx.fns.session.syncAgentState({ agent });
    }

    agent.scratchpad ??= {};
    if (agent.scratchpad.plan?.pausedAt && userText.trim()) {
        const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
            const plan = scratchpad.plan;
            if (!plan?.pausedAt) return;
            plan.pausedAt = null;
            plan.updatedAt = now;
            const active = Array.isArray(plan.tasks) ? plan.tasks.find((task: any) => task.status === 'active') : null;
            if (active && !active.activeSince) active.activeSince = now;
        } });
        agent.scratchpad = updated.scratchpad;
        ctx.fns.events.refreshAgentMeta({ agentId: agent.id, section: 'plan', reason: 'plan-resumed' });
    }
    agent.scratchpad.activeStatusLine = await ctx.fns.agent.statusLineForTurn({ agent });
    // The status line is persisted as a small cursor-excluded user row right
    // behind the message that started this run: the transcript then shows
    // exactly what the model saw, forks inherit it, and the provider prompt
    // cache keeps growing from the tail instead of being invalidated up front.
    // A retried run (provider error, cursor left in place) finds its own row
    // already at the tail and must not append a second copy.
    if (agent.scratchpad.activeStatusLine) {
        const tail = (agent.messages ?? [])[(agent.messages ?? []).length - 1];
        if (tail?.message_type !== 'status_line') {
            await ctx.fns.session.appendMessage({ id: agent.id, message: {
                role: 'user',
                content: `## Current status line\n\n${agent.scratchpad.activeStatusLine}`,
                excluded_from_cursor: true,
                message_type: 'status_line',
            } });
            await ctx.fns.session.syncAgentState({ agent });
        }
    }
    let consumedUserIdx = -1;
    const MAX_TURNS = 300;
    let turns = 0;

    let goalIterations = 0;
    let lastGoalFeedback = "";
    const goalDeadline = Date.now() + 5 * 60_000;
    const planAttempts: Record<string, number> = {};
    let totalPlanInjections = 0;
    while (true) {
        if (++turns > MAX_TURNS) {
            await ctx.fns.session.appendErrorEvent({ id: agent.id, error: `run hit the ${MAX_TURNS}-turn cap — closing; send a message to continue` });
            await ctx.fns.session.appendMessage({ id: agent.id, message: {
                role: 'user',
                content: `This run exceeded ${MAX_TURNS} tool cycles and was closed. Summarize where you are; the user can send a message to continue.`,
                excluded_from_cursor: true,
            } });
            await ctx.fns.session.syncAgentState({ agent });
        delete agent.scratchpad.activeStatusLine;

            return { text: '', usage: null, consumedUserIdx };
        }

        // Steering: read the frontier BEFORE refreshing the transcript, so a
        // message landing between the two gets INTO the call without being
        // counted consumed (a harmless duplicate pass beats a lost message).
        const seen = ((await ctx.fns.procs.db.select({
            sql: "SELECT COALESCE(MAX(idx), -1) AS i FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0",
            params: [agent.id],
        })) as any[])[0];
        consumedUserIdx = Math.max(consumedUserIdx, Number(seen?.i ?? -1));
        await ctx.fns.session.syncAgentState({ agent });

        // Keep the current prose in live memory for native clients. Persisting
        // every token would hammer Postgres; the final assistant event remains
        // the durable source of truth. A monotonically increasing revision lets
        // pollers replace one transient bubble without creating duplicates.
        const mobileStream = { text: "", revision: 0, startedAt: Date.now() };
        agent.scratchpad.mobileStream = mobileStream;
        const { text, usage, finishReason, toolCalls = [] } = await ctx.fns.llm.stream({
            agent,
            signal: ac.signal,
            onEvent: (event: any) => {
                if (event?.type !== "text_delta" || typeof event.delta !== "string") return;
                mobileStream.text += event.delta;
                mobileStream.revision++;
            },
        });
        delete agent.scratchpad.mobileStream;
        const prose = String(text ?? '');
        delete agent.scratchpad.activeGoalFeedback;

        // A reply cut off at the token limit can end mid-arguments: the JSON
        // never closed, so the call arrives as {__unparsed}. Executing that is
        // meaningless and the schema would complain about the wrong thing —
        // NOTHING runs, and the model is told what actually happened.
        if (finishReason === 'length' && toolCalls.some((c: any) => c?.args?.__unparsed !== undefined)) {
            await ctx.fns.session.appendErrorEvent({ id: agent.id, error: 'reply truncated at token limit — tool calls not executed' });
            await ctx.fns.session.appendMessage({ id: agent.id, message: {
                role: 'user',
                content: 'Your reply hit the token limit and was cut off mid-call, so NOTHING was executed. '
                    + 'Re-issue the call with a smaller payload: split a large write into several calls, '
                    + 'or produce big content with eval instead of passing it as an argument.',
                excluded_from_cursor: true,
            } });
            await ctx.fns.session.syncAgentState({ agent });
            continue;
        }

        // The assistant turn is ONE row, carrying both what it said and what it
        // called — that pairing is what the next request replays.
        if (!prose.trim() && toolCalls.length === 0) {
            return { text: prose, usage, consumedUserIdx };
        }

        const append = await ctx.fns.session.appendMessage({ id: agent.id, message: {
            role: 'assistant',
            content: prose,
            tool_calls: toolCalls.length ? toolCalls : undefined,
        } });
        await ctx.fns.session.syncAgentState({ agent });

        if (prose.trim()) {
            const html = await ctx.fns.markdown.render({ source: prose, fileBaseDir: agent.workspaceDir || process.cwd() });
            const activeStatus = String(agent.scratchpad?.activeStatusLine ?? "");
            const instructionIndicators = {
                statusLine: activeStatus.split("\n").find((line: string) => line.startsWith("User status line: "))?.slice("User status line: ".length) || null,
            };
            await ctx.fns.session.appendAssistantEvent({ id: agent.id, payload: {
                text: prose, html, usage, messageIdx: append.idx, instructionIndicators,
            } });
            await ctx.fns.session.syncAgentState({ agent });
        }

            const goal = agent.goal;
        if (toolCalls.length === 0) {
            if (goal?.enabled && goal?.statement) {
                const check = await ctx.fns.agent.checkGoal({ agent, candidateAnswer: prose });
                const feedback = `${check.reason}\n${check.nextStep ?? ""}`.trim();
                const maxIterations = Math.max(1, Math.min(10, Number(goal.maxIterations ?? 3)));
                const withinBudget = goalIterations < maxIterations;
                const withinTime = Date.now() < goalDeadline;
                const hasProgress = feedback !== lastGoalFeedback;
                const canContinue = check.status === "continue" && withinBudget && withinTime && hasProgress;
                const effectiveCheck = check.status === "continue" && !canContinue ? {
                    status: "limit_reached",
                    reason: !withinBudget
                        ? `Goal continuation limit (${maxIterations}) reached. Last check: ${check.reason}`
                        : !withinTime
                        ? `Goal continuation deadline reached. Last check: ${check.reason}`
                        : `Goal checker repeated the same feedback. Last check: ${check.reason}`,
                    nextStep: check.nextStep,
                    evidence: check.evidence,
                } : check;
                await ctx.fns.agent.recordGoalCheck({ agent, check: effectiveCheck });

                const displayIteration = canContinue ? goalIterations + 1 : Math.min(goalIterations, maxIterations);
                const label = effectiveCheck.status === "achieved"
                    ? `Goal achieved: ${effectiveCheck.reason}`
                    : effectiveCheck.status === "limit_reached"
                    ? `Goal check limit reached: ${effectiveCheck.reason}`
                    : `Goal check: ${effectiveCheck.status}. ${effectiveCheck.reason}${effectiveCheck.nextStep ? `\nNext: ${effectiveCheck.nextStep}` : ""}`;
                const feedbackRow = await ctx.fns.session.appendMessage({ id: agent.id, message: {
                    role: "user",
                    content: label,
                    message_type: "goal_feedback",
                    excluded_from_cursor: true,
                } });
                await ctx.fns.session.appendEvent({ id: agent.id, event: {
                    type: "goal_check",
                    status: effectiveCheck.status,
                    reason: effectiveCheck.reason,
                    nextStep: effectiveCheck.nextStep ?? null,
                    iteration: displayIteration,
                    maxIterations,
                    messageIdx: feedbackRow.idx,
                } });
                await ctx.fns.session.syncAgentState({ agent });

                if (canContinue) {
                    goalIterations++;
                    lastGoalFeedback = feedback;
                    continue;
                }
            }

            const plan = agent.scratchpad?.plan;
            const activeTask = Array.isArray(plan?.tasks) ? plan.tasks.find((task: any) => task.status === "active") : null;
            const attempts = activeTask ? Number(planAttempts[activeTask.id] ?? 0) : 0;
            if (activeTask && !plan.pausedAt && attempts < 2 && totalPlanInjections < 5) {
                planAttempts[activeTask.id] = attempts + 1;
                totalPlanInjections++;
                const feedback = [
                    `Continue the active plan task.`,
                    `Task ID: ${activeTask.id}`,
                    `Title: ${activeTask.title}`,
                    activeTask.instructions ? `Instructions:\n${activeTask.instructions}` : "",
                    `Call session.done({ agent, id: ${JSON.stringify(activeTask.id)} }) only after the task is complete.`,
                ].filter(Boolean).join("\n\n");
                await ctx.fns.session.appendMessage({ id: agent.id, message: {
                    role: "user",
                    content: feedback,
                    message_type: "plan_feedback",
                    excluded_from_cursor: true,
                } });
                await ctx.fns.session.syncAgentState({ agent });
                continue;
            }


            delete agent.scratchpad.activeStatusLine;
            observeCompletedTurn(append.idx);
            return { text: prose, usage, consumedUserIdx };
        }

        // Every answer row is written NOW, empty, right after the call it
        // belongs to — before a single tool runs. A call with no result is a
        // transcript every provider rejects, and a run can die mid-flight (a
        // restart, a kill, a sleeping machine); with the row already in place
        // the worst case is an honest "interrupted", not an agent that can
        // never speak again because its own history is malformed.
        const pending: Record<string, number> = {};
        for (const call of toolCalls) {
            const row = await ctx.fns.session.appendMessage({ id: agent.id, message: {
                role: 'tool',
                content: `(${call.name} is running — interrupted before it reported back)`,
                tool_call_id: call.id,
                excluded_from_cursor: true,
            } });
            pending[call.id] = row.idx;
        }
        await ctx.fns.session.syncAgentState({ agent });

        // Calls in one reply are independent by construction — no protocol lets
        // a later call read an earlier one's result — so a failure does not
        // invalidate its neighbours. Each is executed and its row filled in.
        // A terminal payload is only acted on AFTER every tool-result row is
        // filled, preserving the provider's native tool-call transcript.
        let terminal: { type: 'html'; html: string; text: string } | undefined;
        for (const call of toolCalls) {
            const r = await ctx.fns.tools.call({ name: call.name, args: call.args, agent });
            const output = await ctx.fns.agent.stashResult({ agent, output: r.output, kind: call.name });

            // Events store data, never rendered markup. renderEventHtml builds
            // the current view on every read, so renderer improvements apply to
            // old calls too (including edit diff cards).
            await ctx.fns.session.appendToolCallEvent({ id: agent.id, payload: {
                name: call.name, args: call.args, result: output,
                isError: r.isError,
                messageIdx: append.idx,
            } });

            await ctx.fns.session.updateMessageContent({
                id: agent.id,
                idx: pending[call.id]!,
                content: r.content?.length ? [{ type: 'text', text: output }, ...r.content] : output,
            });
            if (!r.isError && r.terminal?.type === 'html') terminal = r.terminal;
        }
        await ctx.fns.session.syncAgentState({ agent });

        if (terminal) {
            const text = terminal.text.trim() || 'HTML response';
            const html = ctx.fns.agent.sanitizeHtmlBody({ html: terminal.html });
            const final = await ctx.fns.session.appendMessage({ id: agent.id, message: {
                role: 'assistant',
                content: text,
            } });
            const activeStatus = String(agent.scratchpad?.activeStatusLine ?? '');
            const instructionIndicators = {
                statusLine: activeStatus.split('\n').find((line: string) => line.startsWith('User status line: '))?.slice('User status line: '.length) || null,
            };
            await ctx.fns.session.appendAssistantEvent({ id: agent.id, payload: {
                text, html, usage, messageIdx: final.idx, instructionIndicators,
            } });
            await ctx.fns.session.syncAgentState({ agent });
            delete agent.scratchpad.activeStatusLine;
            observeCompletedTurn(final.idx);
            return { text, html, usage, consumedUserIdx, terminal: true };
        }
    }
}
