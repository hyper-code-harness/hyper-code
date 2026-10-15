import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

const ref = { version: 1, id: '123e4567-e89b-42d3-a456-426614174000', ownerAgentId: 'a1', bytes: 12000, sha256: 'a'.repeat(64), kind: 'text' };
const seed = () => ({ id: 'a1', model: 'm', systemPrompt: '', scratchpad: { plan: { title: 'Keep me' } }, messages: [], events: [], cursors: {}, subscribers: new Set(), waiters: [], isStreaming: false, abortController: null });

describe('session result_ref persistence', () => {
    test('append, load, save and replacement retain metadata and ordinary messages stay unreferenced', async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.session.save({ agent: seed() as any });
        await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'tool', content: 'preview', tool_call_id: 'tc', excluded_from_cursor: true, result_ref: ref } });
        await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'user', content: 'ordinary' } });
        const loaded = await ctx.fns.session.load({ id: 'a1' });
        expect(loaded.messages[0].result_ref).toEqual(ref);
        expect(loaded.messages[1].result_ref).toBeUndefined();
        await ctx.fns.session.save({ agent: loaded });
        await ctx.fns.session.replaceMessages({ id: 'a1', messages: loaded.messages });
        const rows = await ctx.fns.session.getMessages({ id: 'a1', includeExcluded: true });
        expect(rows[0]).toMatchObject({ result_ref: ref, tool_call_id: 'tc', excluded_from_cursor: true });
        expect((await ctx.fns.session.load({ id: 'a1' })).scratchpad.plan.title).toBe('Keep me');
    });

    test('placeholder update sets, preserves and explicitly clears result_ref', async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.session.save({ agent: seed() as any });
        await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'tool', content: '', tool_call_id: 'tc' } });
        await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 0, content: 'preview', result_ref: ref });
        await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 0, content: 'revised' });
        expect((await ctx.fns.session.getMessages({ id: 'a1' }))[0].result_ref).toEqual(ref);
        await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 0, content: 'small', result_ref: null });
        expect((await ctx.fns.session.getMessages({ id: 'a1' }))[0].result_ref).toBeUndefined();
    });

    test('fork inherits owner references but drops legacy bodies without mutating parent plans or results', async () => {
        const ctx: any = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: 'm', systemPrompt: '' });
        parent.scratchpad = { results: { r1: 'old body' }, resultSeq: 1, plan: { title: 'Keep me' }, planHistory: ['old plan'] };
        await ctx.fns.session.save({ agent: parent });
        await ctx.fns.session.appendMessage({ id: parent.id, message: { role: 'tool', content: 'preview', tool_call_id: 'tc', result_ref: { ...ref, ownerAgentId: parent.id } } });
        const child = await ctx.fns.session.fork({ id: parent.id });
        expect(child.scratchpad).toEqual({ plan: { title: 'Keep me' }, planHistory: ['old plan'] });
        expect(parent.scratchpad.results.r1).toBe('old body');
        expect((await ctx.fns.session.load({ id: parent.id })).scratchpad.resultSeq).toBe(1);
        expect((await ctx.fns.session.getFullMessages({ id: child.id }))[0].result_ref.ownerAgentId).toBe(parent.id);
        await ctx.fns.session.appendMessage({ id: child.id, message: { role: 'user', content: 'child own' } });
        const loadedChild = await ctx.fns.session.load({ id: child.id });
        await ctx.fns.session.save({ agent: loadedChild });
        expect((await ctx.fns.session.getFullMessages({ id: child.id })).length).toBe(2);
        expect((await ctx.fns.session.getMessages({ id: child.id })).length).toBe(1);
        await expect(ctx.fns.session.delete({ id: parent.id })).rejects.toThrow('dependent forks');
        expect((await ctx.fns.session.getFullMessages({ id: child.id }))[0].result_ref.ownerAgentId).toBe(parent.id);
    });
});
