import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

function body(idx: string, mode: string): FormData {
  const form = new FormData();
  form.set('idx', idx);
  form.set('mode', mode);
  return form;
}

describe('POST /agent/:id/messages/delete', () => {
  test('delete one redirects back', async () => {
    const ctx = await mkTestCtx();
    const calls: any[] = [];
    const reg = ctx.state.registry;
    reg.session.load = () => null;
    reg.session.deleteMessageAt = (_c: any, _s: any, o: { id: string; idx: number }) => { calls.push(['one', o.id, o.idx]); return { ok: true }; };
    reg.session.truncateMessagesFrom = () => ({ ok: true });
    reg.session.syncAgentState = () => {};
    (ctx.state as any).agent = { a1: { id: 'a1' } };

    const res = await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/agent/a1/messages/delete', body: body('2', 'one') });
    expect(res.status).toBe(303);
    expect(calls[0]).toEqual(['one', 'a1', 2]);
  });

  test('HTMX deletion explicitly refreshes the page', async () => {
    const ctx = await mkTestCtx();
    const reg = ctx.state.registry;
    reg.session.load = () => null;
    reg.session.deleteMessageAt = () => ({ ok: true });
    reg.session.syncAgentState = () => {};
    (ctx.state as any).agent = { a1: { id: 'a1' } };
    const res = await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/agent/a1/messages/delete', headers: { 'hx-request': 'true' }, body: body('2', 'one') });
    expect(res.status).toBe(204);
    expect(res.headers.get('HX-Refresh')).toBe('true');
  });

  test('delete from redirects back', async () => {
    const ctx = await mkTestCtx();
    const calls: any[] = [];
    const reg = ctx.state.registry;
    reg.session.load = () => null;
    reg.session.deleteMessageAt = () => ({ ok: true });
    reg.session.truncateMessagesFrom = (_c: any, _s: any, o: { id: string; from: number }) => { calls.push(['from', o.id, o.from]); return { ok: true, from: o.from }; };
    reg.session.syncAgentState = () => {};
    (ctx.state as any).agent = { a1: { id: 'a1' } };

    const res = await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/agent/a1/messages/delete', body: body('3', 'from') });
    expect(res.status).toBe(303);
    expect(calls[0]).toEqual(['from', 'a1', 3]);
  });
});
