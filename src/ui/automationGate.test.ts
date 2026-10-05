import { test, expect } from 'bun:test';
import render from './agentMetaSection';
import { renderCtx, spy } from './testRender.entry';

// These three switches used to live in Automation and this test still asked
// that section for them, so it went on failing after they moved into Agent
// settings — a mock ctx that lacked `procs.ui.button` hid the real reason
// behind a TypeError for months.
//
// What it is actually about: the gate and the reranker are INDEPENDENT of each
// other. Both only make sense with retrieval on, but neither implies the
// other, so they are three separate switches and never a tri-state.
test('the gate and the reranker are independent switches under agent settings', async () => {
    // The real kit, with one component recorded: the assertion is about what
    // the renderer ASKED for, so the real toggle still renders underneath.
    const toggle = spy('ui.toggle', (_c: any, _s: any, o: any) => `<input name="${o.name}">`);
    const ctx = await renderCtx(toggle.override);
    const html = render(ctx, null, {
        section: 'settings',
        agent: { id: 'test', functionRagEnabled: true, functionRagGateEnabled: true, jevRerankEnabled: false } as any,
    });
    expect(html).toContain('functionRagGateEnabled');
    expect(toggle.calls.map((x: any) => [x.name, x.enabled])).toEqual([
        ['functionRagEnabled', true],
        ['functionRagGateEnabled', true],
        ['jevRerankEnabled', false],
    ]);
    // And they are not also drawn in Automation, which is where they were.
    const automation = render(ctx, null, { section: 'automation', agent: { id: 'test' } as any });
    expect(automation).not.toContain('functionRagGateEnabled');
});
