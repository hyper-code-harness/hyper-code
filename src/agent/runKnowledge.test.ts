import { describe, expect, test } from 'bun:test';
import run from './run';
import updateSidecar from '../../plugins/knowledge/src/knowledge/updateSidecar';

// Entirely in-memory: no runtime bootstrap, shared DB, or real Knowledge writes.
function harness(turns: any[], scratchpad: any = { knowledgeTrackingEnabled: true }) {
    const rows: any[] = [];
    const launches: any[] = [];
    const agent: any = { id: 'mock', scratchpad, messages: [], events: [] };
    const appendMessage = async ({ message }: any) => { const row = { ...message, idx: rows.length }; rows.push(row); return row; };
    const noop = async () => {};
    const ctx: any = { fns: {
        session: { forAgent: () => ({}), appendUserMessage: ({ text }: any) => appendMessage({ message: { role: 'user', content: text } }), appendMessage,
            syncAgentState: async () => { agent.messages = rows.map(r => ({ ...r })); }, appendAssistantEvent: noop, appendErrorEvent: noop, appendToolCallEvent: noop,
            updateMessageContent: async ({ idx, content }: any) => { rows[idx].content = content; } },
        agent: { statusLineForTurn: async () => '', stashResult: async ({ output }: any) => ({ content: output }), sanitizeHtmlBody: ({ html }: any) => html },
        procs: { db: { select: async () => [{ i: Math.max(-1, ...rows.filter(r => r.role === 'user').map(r => r.idx)) }] } },
        llm: { stream: async () => { const turn = turns.shift(); if (turn instanceof Error) throw turn; return turn ?? { text: 'done' }; } },
        markdown: { render: async ({ source }: any) => source },
        tools: { list: () => [], call: async ({ name }: any) => ({ output: 'tool persisted', ...(name === 'respondHtml' ? { terminal: { type: 'html', html: '<p>final</p>', text: 'final' } } : {}) }) },
        knowledge: { updateSidecar: async (o: any) => { launches.push({ messageIdx: o.messageIdx, rows: rows.map(r => ({ ...r })) }); } },
    } };
    return { ctx, agent, rows, launches, execute: (already = false) => run(ctx, null, { agent, userText: 'question', userMessageAlreadyAppended: already }) };
}

describe('Knowledge completed-turn hook (isolated)', () => {
    test('tool result references accompany preview in persisted messages and events', async () => {
        const h = harness([{ toolCalls: [{ id: 't', name: 'read', args: {} }] }, { text: 'answer' }]);
        const ref = { version: 1, id: 'result-uuid', ownerAgentId: 'mock', bytes: 7000, sha256: 'hash', kind: 'read' };
        const events: any[] = [];
        h.ctx.fns.agent.stashResult = async () => ({ content: 'bounded preview', result_ref: ref });
        h.ctx.fns.session.updateMessageContent = async ({ idx, content, result_ref }: any) => Object.assign(h.rows[idx], { content, result_ref });
        h.ctx.fns.session.appendToolCallEvent = async ({ payload }: any) => events.push(payload);
        await h.execute();
        expect(h.rows.find((r: any) => r.role === 'tool')).toMatchObject({ content: 'bounded preview', result_ref: ref });
        expect(events[0]).toMatchObject({ result: 'bounded preview', result_ref: ref });
    });
    test('direct run extracts once after final prose and completed tool rows', async () => {
        const h = harness([{ text: 'working', toolCalls: [{ id: 't', name: 'read', args: {} }] }, { text: 'answer' }]);
        await h.execute();
        expect(h.launches).toHaveLength(1);
        expect(h.launches[0].messageIdx).toBe(3);
        expect(h.launches[0].rows.map((r: any) => r.content)).toEqual(['question', 'working', 'tool persisted', 'answer']);
    });
    test('worker-style pre-appended input and terminal HTML include all tool results and final assistant', async () => {
        const h = harness([{ toolCalls: [{ id: 't', name: 'respondHtml', args: {} }, { id: 'u', name: 'read', args: {} }] }]);
        h.rows.push({ idx: 0, role: 'user', content: 'queued' });
        const result = await h.execute(true);
        expect(result.terminal).toBe(true);
        expect(h.launches).toHaveLength(1);
        expect(h.launches[0].messageIdx).toBe(4);
        expect(h.launches[0].rows.slice(2).map((r: any) => r.content)).toEqual(['tool persisted', 'tool persisted', 'final']);
    });
    test('cutoff is final append index, not concurrently arriving user index', async () => {
        const h = harness([{ text: 'answer' }]);
        h.ctx.fns.session.appendAssistantEvent = async () => { h.rows.push({ idx: h.rows.length, role: 'user', content: 'next turn' }); };
        await h.execute();
        expect(h.launches[0].messageIdx).toBe(1);
        expect(h.rows.at(-1).idx).toBe(2);
    });
    test('disabled, absent plugin, and observer forks never launch', async () => {
        for (const flags of [{}, { knowledgeTrackingEnabled: false }, { knowledgeTrackingEnabled: true, knowledgeSidecarFor: 'p' }, { knowledgeTrackingEnabled: true, goalSidecarFor: 'p' }]) {
            const h = harness([{ text: 'answer' }], flags); await h.execute(); expect(h.launches).toHaveLength(0);
        }
        const h = harness([{ text: 'answer' }]); delete h.ctx.fns.knowledge;
        await h.execute(); expect(h.launches).toHaveLength(0);
    });
    test('LLM errors, aborted responses and empty responses do not launch', async () => {
        const h = harness([new Error('provider failed')]); await expect(h.execute()).rejects.toThrow('provider failed'); expect(h.launches).toHaveLength(0);
        const empty = harness([{ text: '' }]); await empty.execute(); expect(empty.launches).toHaveLength(0);
        const aborted = harness([]); aborted.ctx.fns.llm.stream = async () => { aborted.agent.abortController.abort(); return { text: 'partial' }; };
        await aborted.execute(); expect(aborted.launches).toHaveLength(0);
    });
    test('extraction is not awaited and sync/async plugin failures do not fail the turn', async () => {
        for (const impl of [() => { throw new Error('sync'); }, async () => { throw new Error('async'); }, () => new Promise(() => {})]) {
            const h = harness([{ text: 'answer' }]); h.ctx.fns.knowledge.updateSidecar = impl;
            expect((await h.execute()).text).toBe('answer'); await Promise.resolve();
        }
    });
    test('runner uses writer-visible sources, tolerates excluded cutoff and preserves applied checkpoint on failure', async () => {
        const parent: any = { id: 'p', scratchpad: { knowledgeSidecar: { status: 'error', appliedSourceMessageIdx: 1, lastSuccessfulMessageIdx: 0, sourceMessageIdx: 9 } } };
        const child: any = { id: 'c' }; let requested: any; let archived = false;
        const ctx: any = { fns: {
            procs: { db: { select: async () => [] } }, knowledge: { extractionSchema: async () => ({ types: [], attributes: [], vocabularies: {} }) },
            session: { getMessages: async (o: any) => { requested = o; return [{ idx: 1, role: 'user', content: 'old' }, { idx: 2, role: 'tool', content: 'tool evidence' }, { idx: 4, role: 'user', content: 'future' }]; },
                fork: async () => child, save: async () => {}, mutateScratchpad: async ({ mutate }: any) => ({ result: mutate(parent.scratchpad, 123), scratchpad: parent.scratchpad }), archive: async () => { archived = true; } },
            settings: { getNumber: async () => 1000 }, agent: { run: async () => { throw new Error('extraction failed'); } }, events: { refreshAgentMeta: () => {} },
        } };
        parent.scratchpad.knowledgeSidecar.sourceMessageIdx = 1;
        const result = await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 });
        expect(requested).toEqual({ id: 'p' });
        expect(child.scratchpad.sourceMessages.map((r: any) => r.idx)).toEqual([2]);
        expect(result.status).toBe('error'); expect(parent.scratchpad.knowledgeSidecar.appliedSourceMessageIdx).toBe(1); expect(archived).toBe(true);
        expect(parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx).toBe(1);
        // Writer contract: only appliedSourceMessageIdx advances on a successful write.
        ctx.fns.agent.run = async () => { parent.scratchpad.knowledgeSidecar = { ...parent.scratchpad.knowledgeSidecar, status: 'ready', sidecarId: 'c', appliedSourceMessageIdx: 3, sourceMessageIdx: 3 }; };
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('ready');
        expect(parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx).toBe(1);
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('duplicate');
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 2 })).status).toBe('stale');
        // A concurrent successful writer must win both normal and error completion.
        for (const throws of [false, true]) {
            parent.scratchpad.knowledgeSidecar = { status: 'error', appliedSourceMessageIdx: 1, lastSuccessfulMessageIdx: 0 };
            ctx.fns.agent.run = async () => { parent.scratchpad.knowledgeSidecar = { status: 'error', appliedSourceMessageIdx: 5, lastSuccessfulMessageIdx: 0 }; if (throws) throw new Error('late failure'); };
            expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('stale');
            expect(parent.scratchpad.knowledgeSidecar.appliedSourceMessageIdx).toBe(5);
        }
    });
});
