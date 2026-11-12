import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

// The memory hook (agent.promptAugment) adds a "## Your memory" world-state row before the first request; these
// tests pin the transcript shape of the turn itself, so they run without it (syncWorldState.test.ts covers it).
async function quietCtx() {
    const ctx: any = await mkTestCtx();
    delete ctx.state.procs.hooks.handlers['agent.promptAugment'];
    return ctx;
}

async function mkAgent(ctx: any, turns: any[]) {
    const agent = await ctx.fns.agent.start({ model: 'mock:test' });
    agent.scratchpad.mockLLM = { turns, defaultText: 'done' };
    await ctx.fns.session.save({ agent });
    return agent;
}

describe('agent.run', () => {
    test('a tool call round-trips: assistant row carries the call, a tool row answers it by id', async () => {
        const ctx: any = await quietCtx();
        ctx.fns.files.read = async (_c: any, _s: any, o: any) => `CONTENT OF ${o.path}`;

        const agent = await mkAgent(ctx, [
            { text: 'Смотрю файл.', toolCalls: [{ name: 'read', args: { path: 'src/x.ts' } }] },
            { text: 'Там лежит контент.' },
        ]);
        await ctx.fns.agent.run({ agent, userText: 'что в файле?' });

        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        expect(msgs.map((m: any) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

        const call = msgs[1]!.tool_calls[0];
        expect(call).toMatchObject({ name: 'read', args: { path: 'src/x.ts' } });
        expect(msgs[2]!.tool_call_id).toBe(call.id);
        expect(msgs[2]!.content).toBe('CONTENT OF src/x.ts');
        expect(msgs[3]!.content).toBe('Там лежит контент.');

        // the UI renders from events, so the call has to show up there too
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        const toolEvent = events.find((e: any) => e.type === 'tool_call');
        expect(toolEvent).toMatchObject({ name: 'read', isError: false });
    });

    test('parallel calls in one reply each get their own answer', async () => {
        const ctx: any = await quietCtx();
        ctx.fns.files.read = async (_c: any, _s: any, o: any) => `READ:${o.path}`;
        ctx.fns.files.grep = async () => [{ path: 'a.ts', line: 1, column: 2, text: 'hit' }];

        const agent = await mkAgent(ctx, [
            { toolCalls: [
                { name: 'read', args: { path: 'a.ts' } },
                { name: 'grep', args: { pattern: 'hit' } },
            ] },
            { text: 'оба готовы' },
        ]);
        await ctx.fns.agent.run({ agent, userText: 'go' });

        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        expect(msgs.map((m: any) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
        expect(msgs[1]!.tool_calls).toHaveLength(2);
        expect(msgs[2]!.content).toBe('READ:a.ts');
        expect(msgs[3]!.content).toBe('a.ts:1:2: hit');
        expect([msgs[2]!.tool_call_id, msgs[3]!.tool_call_id])
            .toEqual(msgs[1]!.tool_calls.map((c: any) => c.id));
    });

    test('a bad argument comes back as the tool answer, and the loop keeps going', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, [
            { toolCalls: [{ name: 'read', args: { path: 'a.ts', maxLine: 3 } }] },
            { text: 'понял, опция называется maxLines' },
        ]);
        await ctx.fns.agent.run({ agent, userText: 'go' });

        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        expect(msgs[2]!.role).toBe('tool');
        expect(msgs[2]!.content).toContain('unknown option "maxLine"');
        expect(msgs[3]!.content).toContain('maxLines');

        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.find((e: any) => e.type === 'tool_call')!.isError).toBe(true);
    });


    test('tool schemas go on the wire in the endpoint dialect', async () => {
        const ctx: any = await quietCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });

        const wire = ctx.fns.agent.wireTools({ agent, api: 'anthropic' });
        expect(wire.map((t: any) => t.name).sort()).toEqual(['bash', 'edit', 'eval', 'find', 'grep', 'read', 'respondHtml', 'write']);

        const narrowed = ctx.fns.agent.wireTools({ agent: { ...agent, tools: ['read'] }, api: 'openai' });
        expect(narrowed).toHaveLength(1);
    });
});

describe('transcript surgery keeps JSON pairs intact', () => {
    async function withPair(ctx: any) {
        ctx.fns.files.read = async () => 'FILE';
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
            agent.scratchpad.mockLLM = { turns: [
            { toolCalls: [{ name: 'read', args: { path: 'a.ts' } }] },
            { text: 'готово' },
        ] };
        await ctx.fns.session.save({ agent });
        await ctx.fns.agent.run({ agent, userText: 'go' });
        return agent;
    }

    test('deleting half a JSON pair is refused, like half a marker pair', async () => {
        const ctx: any = await quietCtx();
        const agent = await withPair(ctx);
        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        const callIdx = 1, resultIdx = 2;

        expect(await ctx.fns.session.deleteMessageAt({ id: agent.id, idx: callIdx }))
            .toMatchObject({ ok: false });
        expect(await ctx.fns.session.deleteMessageAt({ id: agent.id, idx: resultIdx }))
            .toMatchObject({ ok: false });
        expect((await ctx.fns.session.getMessages({ id: agent.id })).length).toBe(msgs.length);
    });

    test('truncating into a pair walks back to the call', async () => {
        const ctx: any = await quietCtx();
        const agent = await withPair(ctx);

        // idx 2 is the tool result — cutting there must take its call with it
        await ctx.fns.session.truncateMessagesFrom({ id: agent.id, from: 2 });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        expect(msgs.map((m: any) => m.role)).toEqual(['user']);
    });

    test('rewriting the transcript preserves tool_calls and tool_call_id', async () => {
        const ctx: any = await quietCtx();
        const agent = await withPair(ctx);

        const before = await ctx.fns.session.getMessages({ id: agent.id });
        await ctx.fns.session.replaceMessages({ id: agent.id, messages: before });
        const after = await ctx.fns.session.getMessages({ id: agent.id });

        expect(after[1]!.tool_calls).toEqual(before[1]!.tool_calls);
        expect(after[2]!.tool_call_id).toBe(before[1]!.tool_calls[0].id);

        // …and so does session.save, which rewrites every row from memory
        await ctx.fns.session.syncAgentState({ agent });
        await ctx.fns.session.save({ agent });
        const saved = await ctx.fns.session.getMessages({ id: agent.id });
        expect(saved[1]!.tool_calls[0].name).toBe('read');
        expect(saved[2]!.tool_call_id).toBe(saved[1]!.tool_calls[0].id);
    });

    test('a reply truncated mid-arguments executes nothing and says so', async () => {
        const ctx: any = await quietCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
            let ran = 0;
        ctx.fns.tools.read = async () => { ran++; return 'x'; };
        ctx.fns.llm.stream = async () => ({
            text: '', usage: null, finishReason: 'length',
            toolCalls: [{ id: 'c1', name: 'read', args: { __unparsed: '{"path": "a.t' } }],
        });
        await ctx.fns.session.save({ agent });

        const turns: any[] = [];
        ctx.fns.llm.stream = async () => turns.length++
            ? { text: 'ok', usage: null, finishReason: 'stop', toolCalls: [] }
            : { text: '', usage: null, finishReason: 'length', toolCalls: [{ id: 'c1', name: 'read', args: { __unparsed: '{"path": "a.t' } }] };

        await ctx.fns.agent.run({ agent, userText: 'go' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(ran).toBe(0);
        expect(msgs.some((m: any) => String(m.content).includes('cut off mid-call'))).toBe(true);
    });

    test('respondHtml stores the tool result, sanitizes HTML, publishes one final answer, and skips another LLM turn', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, [
            { toolCalls: [{ name: 'respondHtml', args: {
                html: '<!DOCTYPE html><html><head><script>bad()</script></head><body><section><h2>Sessions</h2></section></body></html>',
                text: 'Sessions list',
            } }] },
            { text: 'THIS TURN MUST NOT RUN' },
        ]);

        const result = await ctx.fns.agent.run({ agent, userText: 'show sessions' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id });
        expect(msgs.map((m: any) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
        expect(msgs[2]!.content).toContain('HTML response accepted');
        expect(msgs[3]!.content).toBe('Sessions list');
        expect(msgs.some((m: any) => String(m.content).includes('THIS TURN MUST NOT RUN'))).toBe(false);

        const events = await ctx.fns.session.getEvents({ id: agent.id });
        const final = events.filter((e: any) => e.type === 'assistant').at(-1);
        expect(final.text).toBe('Sessions list');
        expect(final.html).toBe('<section><h2>Sessions</h2></section>');
        expect(result).toMatchObject({ terminal: true, text: 'Sessions list' });
    });


    // The mock's turn cursor lives on the in-memory scratchpad; plan functions reload the scratchpad from the
    // database, so a stub that calls one keeps the cursor across the call.
    const keepingCursor = async (agent: any, fn: () => Promise<any>) => {
        const turn = agent.scratchpad.mockTurn;
        const out = await fn();
        agent.scratchpad.mockTurn = turn;
        return out;
    };
    const planFeedback = async (ctx: any, id: string) =>
        (await ctx.fns.session.getMessages({ id, includeExcluded: true })).filter((m: any) => m.message_type === 'plan_feedback');

    test('issue #30: reports without a decision never stop the run — only session.done does', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async (_c: any, _s: any, o: any) => {
            if (o.path === 'finish') await keepingCursor(agent, () => ctx.fns.session.done({ agent, id: 'work' }));
            return `CONTENT OF ${o.path}`;
        };
        const report = (n: number) => ({ text: `intermediate report ${n}, still checking` });
        // the ak scenario and worse: five text-only reports in a row, then work, then more reports
        agent = await mkAgent(ctx, [
            report(1), report(2), report(3), report(4), report(5),
            { toolCalls: [{ name: 'read', args: { path: 'a.ts' } }] },
            report(6), report(7),
            { toolCalls: [{ name: 'read', args: { path: 'finish' } }] },
            { text: 'all done' },
        ]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work', instructions: 'Keep going' }] });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        expect(result.text).toBe('all done');
        const feedback = await planFeedback(ctx, agent.id);
        expect(feedback).toHaveLength(7);
        expect(feedback[0].content).toContain('session.pausePlan');
        expect(agent.scratchpad.plan.pausedAt).toBeNull();
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.some((e: any) => e.type === 'plan_paused')).toBe(false);
        // reminders do not move the user cursor
        const cursorRows = await ctx.fns.procs.db.select({ sql: "SELECT excluded_from_cursor FROM messages WHERE agent_id = ? AND message_type = 'plan_feedback'", params: [agent.id] });
        expect(cursorRows.every((row: any) => Number(row.excluded_from_cursor) === 1)).toBe(true);
        const ordinaryUser = (await ctx.fns.procs.db.select({ sql: "SELECT idx FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0 ORDER BY idx", params: [agent.id] }))[0];
        expect(result.consumedUserIdx).toBe(Number(ordinaryUser.idx));
    });

    test('issue #30: every reminder is stored as a message and shown in the chat', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async () => { await keepingCursor(agent, () => ctx.fns.session.done({ agent, id: 'work' })); return 'ok'; };
        agent = await mkAgent(ctx, [{ text: 'report' }, { text: 'report again' }, { toolCalls: [{ name: 'read', args: { path: 'x' } }] }, { text: 'finished' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Ship it' }] });
        await ctx.fns.agent.run({ agent, userText: 'start' });
        const feedback = await planFeedback(ctx, agent.id);
        const notes = (await ctx.fns.session.getEvents({ id: agent.id })).filter((e: any) => e.type === 'system_note');
        expect(notes).toHaveLength(2);
        expect(notes.map((e: any) => e.messageIdx)).toEqual(feedback.map((m: any) => m.idx));
        expect(notes[0]).toMatchObject({ kind: 'plan_feedback', text: feedback[0].content });
        const html = await ctx.fns.agent.renderEventHtml({ event: notes[0], agentId: agent.id });
        expect(html).toContain('Reminder to the agent');
        expect(html).toContain('Ship it');
        expect(html).toContain('session.pausePlan');
    });

    test('issue #30: the agent pauses explicitly — the run ends, the chat shows why and what is left', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async () => {
            await keepingCursor(agent, () => ctx.fns.session.pausePlan({ agent, reason: 'Waiting for the API key from the user' }));
            return 'paused';
        };
        agent = await mkAgent(ctx, [
            { toolCalls: [{ name: 'read', args: { path: 'pause' } }] },
            { text: 'I need the API key to go on.' },
            { text: 'continuing' }, { text: 'still continuing' },
        ]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'implement', title: 'Implement' }, { id: 'verify', title: 'Verify UI' }] });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        expect(result.text).toBe('I need the API key to go on.');
        expect(await planFeedback(ctx, agent.id)).toHaveLength(0);
        expect(agent.scratchpad.plan).toMatchObject({ pausedBy: 'agent', pauseReason: 'Waiting for the API key from the user' });
        expect(agent.scratchpad.plan.tasks[0].activeSince).toBeNull();
        const paused = (await ctx.fns.session.getEvents({ id: agent.id })).find((e: any) => e.type === 'plan_paused');
        expect(paused.remaining.map((t: any) => t.id)).toEqual(['implement', 'verify']);
        const html = await ctx.fns.agent.renderEventHtml({ event: paused, agentId: agent.id });
        expect(html).toContain('Plan paused by the agent');
        expect(html).toContain('Waiting for the API key');
        expect(html).toContain('Verify UI');

        // The person answers through the chat: the worker runs the agent with an EMPTY userText and the message
        // already in the transcript. That must resume the plan (it did not before this fix).
        await ctx.fns.session.appendUserMessage({ id: agent.id, text: 'here is the key' });
        await ctx.fns.session.syncAgentState({ agent });
        agent.scratchpad.mockLLM = { turns: [{ text: 'thanks, continuing' }, { toolCalls: [{ name: 'read', args: { path: 'pause' } }] }, { text: 'waiting again' }] };
        agent.scratchpad.mockTurn = 0;
        await ctx.fns.session.save({ agent }); // resuming reloads the scratchpad from the database
        let resumedSeen = false;
        ctx.fns.files.read = async () => {
            resumedSeen = agent.scratchpad.plan.pausedAt === null;
            await keepingCursor(agent, () => ctx.fns.session.pausePlan({ agent, reason: 'Waiting for review' }));
            return 'paused';
        };
        await ctx.fns.agent.run({ agent, userText: '', userMessageAlreadyAppended: true });
        expect(resumedSeen).toBe(true);
        expect(await planFeedback(ctx, agent.id)).toHaveLength(1);
        expect(agent.scratchpad.plan.pauseReason).toBe('Waiting for review');
    });

    test('issue #30: a plan the person stopped is not resumed by a job or a trigger, only by the person', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, [{ text: 'noted' }, { text: 'again' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        await ctx.fns.session.pausePlan({ agent, by: 'user' });
        await ctx.fns.session.appendMessage({ id: agent.id, message: { role: 'user', content: 'job finished', message_type: 'job' } });
        await ctx.fns.session.syncAgentState({ agent });
        await ctx.fns.agent.run({ agent, userText: '', userMessageAlreadyAppended: true });
        expect(agent.scratchpad.plan.pausedBy).toBe('user');
        expect(await planFeedback(ctx, agent.id)).toHaveLength(0);
    });

    test('continuePlan:false answers once and leaves the plan alone (agent.ask)', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, [{ text: 'the answer' }, { text: 'must not be asked' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        await ctx.fns.session.pausePlan({ agent, reason: 'Waiting for the parent' });
        const result = await ctx.fns.agent.run({ agent, userText: 'a follow-up question', continuePlan: false });
        expect(result.text).toBe('the answer');
        expect(agent.scratchpad.plan.pausedBy).toBe('agent');
        await ctx.fns.session.resumePlan({ agent });
        agent.scratchpad.mockLLM = { turns: [{ text: 'another answer' }, { text: 'must not be asked' }] };
        agent.scratchpad.mockTurn = 0;
        expect((await ctx.fns.agent.run({ agent, userText: 'one more', continuePlan: false })).text).toBe('another answer');
        expect(await planFeedback(ctx, agent.id)).toHaveLength(0);
    });

    test('issue #30: an entirely empty reply with an open task is not a silent stop', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async () => { await keepingCursor(agent, () => ctx.fns.session.done({ agent, id: 'work' })); return 'ok'; };
        agent = await mkAgent(ctx, [{ text: '' }, { toolCalls: [{ name: 'read', args: { path: 'x' } }] }, { text: 'finished' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        expect(result.text).toBe('finished');
        expect(await planFeedback(ctx, agent.id)).toHaveLength(1);
    });

    test('issue #30: the 300-cycle cap is the only stop the runtime makes, and it pauses the plan visibly', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, []);
        agent.scratchpad.mockLLM = { turns: [], defaultText: 'still checking…' };
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'implement', title: 'Implement' }, { id: 'verify', title: 'Verify UI' }] });
        await ctx.fns.agent.run({ agent, userText: 'start' });
        expect(await planFeedback(ctx, agent.id)).toHaveLength(300);
        expect(agent.scratchpad.plan).toMatchObject({ pausedBy: 'limit' });
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        const paused = events.find((e: any) => e.type === 'plan_paused');
        expect(paused).toMatchObject({ by: 'limit' });
        expect(paused.remaining.map((t: any) => t.id)).toEqual(['implement', 'verify']);
        expect(events.some((e: any) => e.type === 'system_note' && e.kind === 'turn_cap')).toBe(true);
        expect(await ctx.fns.agent.renderEventHtml({ event: paused, agentId: agent.id })).toContain('Send a message to resume');
    }, 120_000);

    test('goal continuation runs before plan continuation without conflict', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async () => { await keepingCursor(agent, () => ctx.fns.session.done({ agent, id: 'work' })); return 'ok'; };
        agent = await mkAgent(ctx, [{ text: 'first' }, { text: 'second' }, { toolCalls: [{ name: 'read', args: { path: 'x' } }] }, { text: 'fourth' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        agent.goal = { enabled: true, statement: 'Goal', maxIterations: 1 };
        let checks = 0;
        ctx.state.registry.agent.checkGoal = async () => ++checks === 1
            ? { status: 'continue', reason: 'continue once', nextStep: 'next' }
            : { status: 'achieved', reason: 'done' };
        await ctx.fns.session.save({ agent });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        expect(result.text).toBe('fourth');
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        // 'first' -> the goal says continue; 'second' -> goal achieved (which switches the goal off), then the open
        // plan task asks for a decision; the task is closed; 'fourth' ends the run.
        expect(msgs.filter((m: any) => m.message_type === 'goal_feedback')).toHaveLength(2);
        expect(msgs.filter((m: any) => m.message_type === 'plan_feedback')).toHaveLength(1);
    });

});
