import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

function baseAgent(id: string, extra: any = {}) {
  return { id, model: 'm', systemPrompt: '', scratchpad: {}, messages: [] as any[], events: [] as any[], cursors: {}, subscribers: new Set<(ev: any, signal?: AbortSignal) => void>(), waiters: [], isStreaming: false, abortController: null, parentId: extra.parentId ?? null, forkOffset: extra.forkOffset ?? null };
}

// Counts the rows the two readers hand back, so a test can tell a tail read from a full one.
function countReads(ctx: any) {
  const read = { messages: 0, events: 0 };
  for (const [fn, key] of [['getMessages', 'messages'], ['getEvents', 'events']] as const) {
    const original = ctx.state.registry.session[fn];
    ctx.state.registry.session[fn] = async (c: any, s: any, o: any) => { const rows = await original(c, s, o); read[key] += rows.length; return rows; };
  }
  return read;
}

async function seeded(n: number) {
  const ctx: any = await mkTestCtx();
  const a = baseAgent('a1');
  await ctx.fns.session.save({ agent: a });
  for (let i = 0; i < n; i++) {
    await ctx.fns.session.appendMessage({ id: 'a1', message: { role: i % 2 ? 'assistant' : 'user', content: `m${i}` } });
    await ctx.fns.session.appendEvent({ id: 'a1', event: { type: 'user', text: `e${i}` } });
  }
  await ctx.fns.session.syncAgentState({ agent: a });
  return { ctx, a };
}

// What a sync must always equal: a fresh read of the whole transcript.
async function expectSameAsDb(ctx: any, a: any) {
  expect(a.messages).toEqual(await ctx.fns.session.getMessages({ id: a.id }));
  expect(a.events).toEqual(await ctx.fns.session.getEvents({ id: a.id }));
}

describe('session.syncAgentState', () => {
  test('syncs root agent from db messages/events', async () => {
    const ctx: any = await mkTestCtx();
    const a = baseAgent('a1');
    await ctx.fns.session.save({ agent: a });
    await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'user', content: 'hi' } });
    await ctx.fns.session.appendEvent({ id: 'a1', event: { type: 'user', text: 'hi' } });
    a.messages = []; a.events = [];
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(a.messages.map((m: any) => m.content)).toEqual(['hi']);
    expect(a.events.map((e: any) => e.text)).toEqual(['hi']);
  });

  test('syncs fork agent from full inherited transcript', async () => {
    const ctx: any = await mkTestCtx();
    await ctx.fns.session.save({ agent: baseAgent('parent') });
    await ctx.fns.session.appendMessage({ id: 'parent', message: { role: 'user', content: 'parent hi' } });
    await ctx.fns.session.save({ agent: baseAgent('child', { parentId: 'parent', forkOffset: 1 }) });
    await ctx.fns.session.appendMessage({ id: 'child', message: { role: 'user', content: 'child hi' } });
    const child = baseAgent('child', { parentId: 'parent', forkOffset: 1 });
    await ctx.fns.session.syncAgentState({ agent: child });
    expect(child.messages.map((m: any) => m.content)).toEqual(['parent hi', 'child hi']);
    await ctx.fns.session.appendMessage({ id: 'child', message: { role: 'assistant', content: 'child yo' } });
    await ctx.fns.session.syncAgentState({ agent: child });
    expect(child.messages.map((m: any) => m.content)).toEqual(['parent hi', 'child hi', 'child yo']);
  });

  test('a fork cut at 0 reads only its own rows, never the parent', async () => {
    const ctx: any = await mkTestCtx();
    await ctx.fns.session.save({ agent: baseAgent('parent') });
    await ctx.fns.session.appendMessage({ id: 'parent', message: { role: 'user', content: 'parent hi' } });
    await ctx.fns.session.save({ agent: baseAgent('child', { parentId: 'parent', forkOffset: 0 }) });
    await ctx.fns.session.appendMessage({ id: 'child', message: { role: 'user', content: 'child hi' } });
    const asked: string[] = [];
    const original = ctx.state.registry.session.getMessages;
    ctx.state.registry.session.getMessages = async (c: any, s: any, o: any) => { asked.push(o.id); return original(c, s, o); };
    expect((await ctx.fns.session.getFullMessages({ id: 'child' })).map((m: any) => m.content)).toEqual(['child hi']);
    const child = baseAgent('child', { parentId: 'parent', forkOffset: 0 });
    await ctx.fns.session.syncAgentState({ agent: child });
    expect(child.messages.map((m: any) => m.content)).toEqual(['child hi']);
    expect(asked.includes('parent')).toBe(false);
  });

  test('after an append reads only the new rows and keeps the ones it holds', async () => {
    const { ctx, a } = await seeded(6);
    const first = a.messages[0];
    const read = countReads(ctx);
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(read).toEqual({ messages: 0, events: 0 });
    await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'user', content: 'new' } });
    await ctx.fns.session.appendEvent({ id: 'a1', event: { type: 'user', text: 'new' } });
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(read).toEqual({ messages: 1, events: 1 });
    expect(a.messages[0]).toBe(first);
    expect(a.messages.at(-1).content).toBe('new');
    await expectSameAsDb(ctx, a);
  });

  test('picks up a row inserted by raw sql at the tail', async () => {
    const { ctx, a } = await seeded(3);
    await ctx.fns.procs.db.run({ sql: "INSERT INTO messages (agent_id, idx, role, content, ts) SELECT ?, COALESCE(MAX(idx), -1) + 1, 'user', 'raw', 1 FROM messages WHERE agent_id = ?", params: ['a1', 'a1'] });
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(a.messages.at(-1).content).toBe('raw');
    await expectSameAsDb(ctx, a);
  });

  test('sees a placeholder filled in place, and a replaced event', async () => {
    const { ctx, a } = await seeded(6);
    const read = countReads(ctx);
    await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 3, content: 'filled' });
    await ctx.fns.session.replaceEventAt({ id: 'a1', idx: 4, event: { type: 'turn', outcome: 'ok' } });
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(a.messages[3].content).toBe('filled');
    expect(a.events[4].outcome).toBe('ok');
    expect(read).toEqual({ messages: 3, events: 2 });
    // The edit is replayed once, not on every later sync.
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(read).toEqual({ messages: 3, events: 2 });
    await expectSameAsDb(ctx, a);
  });

  test('every live copy of the agent sees the same edit', async () => {
    const { ctx, a } = await seeded(4);
    const b = baseAgent('a1');
    await ctx.fns.session.syncAgentState({ agent: b });
    await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 1, content: 'filled' });
    await ctx.fns.session.syncAgentState({ agent: a });
    await ctx.fns.session.syncAgentState({ agent: b });
    expect(a.messages[1].content).toBe('filled');
    expect(b.messages[1].content).toBe('filled');
  });

  test('follows deletes, truncation, exclusion and a full replacement', async () => {
    const { ctx, a } = await seeded(8);
    await ctx.fns.session.deleteMessageAt({ id: 'a1', idx: 2 });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.map((m: any) => m.idx)).toEqual([0, 1, 3, 4, 5, 6, 7]);

    await ctx.fns.session.collapseFailures({ id: 'a1', messageIdxs: [4] });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.map((m: any) => m.idx)).toEqual([0, 1, 3, 5, 6, 7]);

    await ctx.fns.session.truncateMessagesFrom({ id: 'a1', from: 6 });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.at(-1).idx).toBe(5);

    // Truncate, then append: the new row takes a freed idx and must replace the stale one in memory.
    await ctx.fns.session.truncateMessagesFrom({ id: 'a1', from: 5 });
    await ctx.fns.session.appendMessage({ id: 'a1', message: { role: 'user', content: 'again' } });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.at(-1).content).toBe('again');

    await ctx.fns.session.replaceMessages({ id: 'a1', messages: [{ role: 'user', content: 'summary' }] });
    await ctx.fns.session.replaceEvents({ id: 'a1', events: [{ type: 'user', text: 'only' }] });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.map((m: any) => m.content)).toEqual(['summary']);
    expect(a.events.map((e: any) => e.text)).toEqual(['only']);
  });

  test('reloads in full when the arrays were replaced or pushed to from outside', async () => {
    const { ctx, a } = await seeded(4);
    a.messages = []; a.events.push({ type: 'user', text: 'local only' });
    await ctx.fns.session.syncAgentState({ agent: a });
    await expectSameAsDb(ctx, a);
    expect(a.messages.length).toBe(4);
    expect(a.events.length).toBe(4);
  });

  test('reloads in full when more edits happened than the log keeps', async () => {
    const { ctx, a } = await seeded(3);
    await ctx.fns.session.updateMessageContent({ id: 'a1', idx: 0, content: 'first edit' });
    for (let i = 0; i < 80; i++) await ctx.fns.session.markChanged({ id: 'a1', messages: 2 });
    await ctx.fns.session.syncAgentState({ agent: a });
    expect(a.messages[0].content).toBe('first edit');
    await expectSameAsDb(ctx, a);
  });
});
