import { expect, test } from 'bun:test';
import render from './initialPromptPopup';

test('initialPromptPopup renders the full prompt as escaped popup content', async () => {
    const agent: any = { id: 'a1', title: 'Demo' };
    const ctx: any = { state: { agent: { a1: agent } }, fns: {
        agent: { fullSystemPrompt: async () => '# CORE\n\n<unsafe>' },
        markdown: { render: async ({ source }: any) => `<h1>CORE</h1><p>${source.includes('<unsafe>') ? '&lt;unsafe&gt;' : ''}</p>` },
        session: { load: async () => null },
        procs: { ui: { escape: ({ text }: any) => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;') } }, w: { escape: ({ text }: any) => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;') },
        ui: { popupContent: ({ title, kind, html }: any) => `<section data-popup-title="${title}" data-popup-kind="${kind}">${html}</section>` },
    } };
    const res = await render(ctx, null, { agentId: 'a1' });
    const html = await res.text();
    expect(html).toContain('Initial prompt · Demo');
    expect(html).toContain('data-popup-kind="initial-prompt"');
    expect(html).toContain('<h1>CORE</h1>');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('<unsafe>');
});
