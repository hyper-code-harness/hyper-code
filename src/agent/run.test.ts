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


    test('plan continuation is bounded and excluded from the user cursor', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, Array.from({ length: 4 }, () => ({ text: 'not finished' })));
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work', instructions: 'Keep going' }] });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        const feedback = msgs.filter((m: any) => m.message_type === 'plan_feedback');
        expect(feedback).toHaveLength(2);
        const cursorRows = await ctx.fns.procs.db.select({ sql: "SELECT idx, excluded_from_cursor FROM messages WHERE agent_id = ? AND message_type = 'plan_feedback' ORDER BY idx", params: [agent.id] });
        expect(cursorRows.every((row: any) => Number(row.excluded_from_cursor) === 1)).toBe(true);
        const ordinaryUser = (await ctx.fns.procs.db.select({ sql: "SELECT idx FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0 ORDER BY idx", params: [agent.id] }))[0];
        expect(result.consumedUserIdx).toBe(Number(ordinaryUser.idx));
    });

    test('issue #30: progress after two nudges keeps the plan task going', async () => {
        const ctx: any = await quietCtx();
        let agent: any;
        ctx.fns.files.read = async (_c: any, _s: any, o: any) => {
            if (o.path === 'finish') {
                const turn = agent.scratchpad.mockTurn; // the mock's cursor is in-memory; done() reloads the scratchpad
                await ctx.fns.session.done({ agent, id: 'work' });
                agent.scratchpad.mockTurn = turn;
            }
            return `CONTENT OF ${o.path}`;
        };
        const report = (n: number) => ({ text: `intermediate report ${n}, still checking` });
        const work = (n: number) => ({ toolCalls: [{ name: 'read', args: { path: `f${n}.ts` } }] });
        agent = await mkAgent(ctx, [
            report(1), report(2),           // two idle replies -> two nudges
            work(1), report(3),             // real progress resets the idle count
            work(2), report(4),
            { toolCalls: [{ name: 'read', args: { path: 'finish' } }] },
            { text: 'all done' },
        ]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        const result = await ctx.fns.agent.run({ agent, userText: 'start' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(msgs.filter((m: any) => m.message_type === 'plan_feedback').length).toBeGreaterThan(2);
        expect(result.text).toBe('all done');
        expect(agent.scratchpad.plan.pausedAt).toBeNull();
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.some((e: any) => e.type === 'plan_paused')).toBe(false);
    });

    test('issue #30: pure repetition still stops and the plan is visibly paused with remaining steps', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, Array.from({ length: 6 }, () => ({ text: 'still checking…' })));
        await ctx.fns.session.plan({ agent, tasks: [
            { id: 'implement', title: 'Implement' },
            { id: 'verify', title: 'Verify UI' },
        ] });
        await ctx.fns.agent.run({ agent, userText: 'start' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(msgs.filter((m: any) => m.message_type === 'plan_feedback')).toHaveLength(2);
        const plan = agent.scratchpad.plan;
        expect(plan.pausedAt).toBeGreaterThan(0);
        expect(plan.pauseReason).toBe('limit');
        expect(plan.tasks[0].activeSince).toBeNull();
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        const paused = events.find((e: any) => e.type === 'plan_paused');
        expect(paused.remaining.map((t: any) => t.id)).toEqual(['implement', 'verify']);
        expect(paused.reason).toContain('no progress');
        const html = await ctx.fns.agent.renderEventHtml({ event: paused, agentId: agent.id });
        expect(html).toContain('Plan paused');
        expect(html).toContain('Verify UI');
        // the next user message resumes the paused plan: continuation starts again
        const firstPause = plan.pausedAt;
        await ctx.fns.agent.run({ agent, userText: 'go on' });
        const after = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(after.filter((m: any) => m.message_type === 'plan_feedback')).toHaveLength(4);
        expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(firstPause);
    });

    test('issue #30: the run-wide cap bounds continuations even when every reply makes progress', async () => {
        const ctx: any = await quietCtx();
        ctx.fns.files.read = async () => 'x';
        const turns: any[] = [];
        for (let i = 0; i < 30; i++) turns.push({ toolCalls: [{ name: 'read', args: { path: `f${i}.ts` } }] }, { text: `report ${i}` });
        const agent = await mkAgent(ctx, turns);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        await ctx.fns.agent.run({ agent, userText: 'start' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(msgs.filter((m: any) => m.message_type === 'plan_feedback')).toHaveLength(12);
        expect(agent.scratchpad.plan.pauseReason).toBe('limit');
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.find((e: any) => e.type === 'plan_paused').reason).toContain('continuation limit');
    });

    test('goal continuation runs before plan continuation without conflict', async () => {
        const ctx: any = await quietCtx();
        const agent = await mkAgent(ctx, [{ text: 'first' }, { text: 'second' }, { text: 'third' }, { text: 'fourth' }]);
        await ctx.fns.session.plan({ agent, tasks: [{ id: 'work', title: 'Work' }] });
        agent.goal = { enabled: true, statement: 'Goal', maxIterations: 1 };
        let checks = 0;
        ctx.state.registry.agent.checkGoal = async () => ++checks === 1
            ? { status: 'continue', reason: 'continue once', nextStep: 'next' }
            : { status: 'achieved', reason: 'done' };
        await ctx.fns.session.save({ agent });
        await ctx.fns.agent.run({ agent, userText: 'start' });
        const msgs = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(msgs.filter((m: any) => m.message_type === 'goal_feedback')).toHaveLength(2);
        expect(msgs.filter((m: any) => m.message_type === 'plan_feedback')).toHaveLength(2);
    });

});
