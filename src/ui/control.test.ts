import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

// Full procs registry ctx; the agent/session/files fns the control helpers
// lean on are replaced with raw `(ctx, session, opts)` stubs, and emitted
// events are captured via the real procs event bus.
const mkCtx = async () => {
  const ctx: any = await mkTestCtx();
  const reg = ctx.state.registry;
  reg.agent.start = (c: any, _s: any, opts: any) => {
    const agent = { id: 'test', model: opts.model, systemPrompt: opts.systemPrompt, tools: opts.tools, events: [], messages: [], scratchpad: {}, isStreaming: false };
    (c.state.agent ??= {})[agent.id] = agent;
    return agent;
  };
  reg.agent.systemPrompt = async () => 'default system';
  reg.agent.run = async (_c: any, _s: any, opts: any) => {
    opts.agent.events.push({ type: 'assistant', text: 'ok:' + opts.userText });
  };
  reg.session.save = () => {};
  reg.settings.getString = (_c: any, _s: any, _o: any) => undefined;
  reg.files.resolveSafe = (_c: any, _s: any, opts: { path: string }) => opts.path;
  reg.files.open = (c: any, _s: any, opts: { path: string }) => { ((c.state as any).openedFiles ??= []).push(opts.path); };
  const emitted: any[] = [];
  ctx.fns.procs.events.subscribe({ handler: (e: any) => emitted.push(e) });
  return { ctx, emitted };
};

describe('ui control helpers', () => {
  test('createAgent creates and optionally opens agent', async () => {
    const { ctx, emitted } = await mkCtx();
    const res = await ctx.fns.ui.createAgent({ model: 'x:test', open: true });
    expect(res.id).toBe('test');
    expect(emitted[0]).toEqual({ type: 'ui.navigate', path: '/agent/test' });
  });

  test('sendToAgent queues run and emits navigate when requested', async () => {
    const { ctx, emitted } = await mkCtx();
    const agent = await ctx.fns.agent.start({ model: 'x:test', systemPrompt: '' });
    const res = await ctx.fns.ui.sendToAgent({ agentId: agent.id, text: 'hello', open: true });
    expect(res.agentId).toBe(agent.id);
    expect(emitted[0]).toEqual({ type: 'ui.navigate', path: '/agent/test' });
  });

  test('notify emits ui.notify event', async () => {
    const { ctx, emitted } = await mkCtx();
    await ctx.fns.ui.notify({ message: 'hi', level: 'warn' });
    expect(emitted[0].type).toBe('ui.notify');
  });

  test('openFile resolves, records and navigates to the Files screen', async () => {
    const { ctx, emitted } = await mkCtx();
    const res = await ctx.fns.ui.openFile({ path: 'src/x.ts' });
    expect(res.opened).toBe('src/x.ts');
    expect(res.url).toBe('/files/absolute/src/x.ts');
    expect((ctx.state as any).openedFiles).toEqual(['src/x.ts']);
    expect(emitted[0]).toEqual({ type: 'ui.navigate', path: '/files/absolute/src/x.ts' });
  });

  test('secure-input SSE lifecycle is owned by popup.js, not legacy control.js', async () => {
    const { ctx } = await mkCtx();
    const script = await ctx.fns.ui.controlScript({});
    expect(script).not.toContain('secure-input-refresh');
    expect(script).not.toContain('secureInputReturnFocus');
    expect(script).not.toContain("createElement('input')");
    expect(ctx.fns.secureInput.submit).toBeFunction();
    expect(ctx.fns.secureInput.current).toBeFunction();
  });


  test('secure-input styling lives in the server-rendered HTMX fragment', async () => {
    const { ctx } = await mkCtx();
    const html = ctx.fns.secureInput.render({ prompt: { id: 'p1', name: 'test-1', title: 'Test', message: 'Enter', kind: 'text', maxlength: 20 } });
    expect(html).toContain('input input-bordered');
    expect(html).toContain('ui-button ui-button--sm ui-button--primary');
    expect(html).toContain('data-secure-cancel');
    // Two hx-popup attributes, and both are load-bearing: the form submits the
    // secret through `secureInput.submit`, and Cancel posts the same method
    // with `cancel: 1` rather than closing the popup in the browser — the
    // waiting agent has to be told, or it waits forever. This asserted one
    // until Cancel grew its own call and then simply went stale.
    expect(html.match(/hx-popup=/g)?.length).toBe(2);
    expect(html).toContain('hx-popup-params=');
  });

});
