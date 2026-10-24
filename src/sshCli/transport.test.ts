import { expect, test } from 'bun:test';
import hosts from './hosts';
import connection from './connection';
import authorize from './authorize';
import resolveEndpoint from '../llm/resolveEndpoint';
import capabilities from '../llm/reasoningCapabilities';
import compaction from '../compaction/resolve';
import stream from '../llm/streamCodex';
import bridge from './inferenceScript';
import save from './saveFromPopup';
import popup from './editPopup';

function context() {
    const ctx: any = { state: {}, fns: {
        settings: { getString: async () => 'gpu', set: async () => ({ ok: true }) },
        remote: { servers: async () => [{ name: 'gpu' }], sshOptions: async () => ({ bin: 'ssh', configFile: '/test/config' }) },
        sshCli: {}, llm: {}, procs: { ui: { escape: ({ text }: any) => Bun.escapeHTML(text), button: () => '<button>Save</button>' } }, ui: { popupContent: ({ html }: any) => html },
    } };
    ctx.fns.sshCli.hosts = () => hosts(ctx, null, {});
    ctx.fns.sshCli.authorize = () => authorize(ctx, null, {});
    ctx.fns.llm.resolveEndpoint = (opts: any) => resolveEndpoint(ctx, null, opts);
    ctx.fns.llm.reasoningCapabilities = (opts: any) => capabilities(ctx, null, opts);
    return ctx;
}

test('only explicitly enabled aliases resolve, without local credential reads', async () => {
    const ctx = context();
    const ep = await resolveEndpoint(ctx, null, { model: 'ssh-codex/gpu:gpt-5.4' });
    expect(ep).toMatchObject({ api: 'responses', apiKey: null, account: 'gpu', provider: 'ssh-codex' });
    await expect(resolveEndpoint(ctx, null, { model: 'ssh-codex/other:gpt-5.4' })).rejects.toThrow('not enabled');
    ctx.fns.settings.getString = async () => '-oProxyCommand=bad';
    await expect(hosts(ctx, null, {})).rejects.toThrow('Invalid');
});

test('SSH never reuses masters and requires verified host keys', async () => {
    const c = await connection(context(), null, { host: 'gpu' });
    expect(c.args).toContain('StrictHostKeyChecking=yes');
    expect(c.args).toContain('BatchMode=yes');
    expect(c.args).toContain('ForwardAgent=no');
    expect(c.args).toContain('ControlMaster=no');
    expect(c.args).toContain('none');
    expect(c.args.at(-1)).toBe('--');
    await expect(connection(context(), null, { host: 'unknown' })).rejects.toThrow();
});

test('reasoning matches Codex and actual compaction entry fails explicitly', async () => {
    const ctx = context();
    expect(await capabilities(ctx, null, { model: 'ssh-codex/gpu:gpt-5.4' })).toEqual(await capabilities(ctx, null, { model: 'codex:gpt-5.4' }));
    expect(() => compaction(ctx, null, { model: 'ssh-codex/gpu:gpt-5.4' })).toThrow('not supported');
});

test('nonowners cannot invoke credential transport', () => {
    expect(() => authorize(context(), { user: { role: 'member' } }, {})).toThrow('Only owners');
    expect(() => authorize(context(), { req: new Request('https://hyper.test') }, {})).toThrow();
    authorize(context(), { kind: 'agent' }, {});
});

test('native popup and saving refuse undeclared aliases and cross-origin mutations', async () => {
    const ctx = context();
    const html = await popup(ctx, null, {});
    expect(html).toContain('hx-popup="sshCli.saveFromPopup"');
    expect(html).toContain('name="hosts"');
    await expect(save(ctx, null, { hosts: 'nope' })).rejects.toThrow('not declared');
    await expect(save(ctx, { req: new Request('https://hyper.test/rpc', { method: 'POST', headers: { origin: 'https://evil.test' } }) }, { hosts: 'gpu' })).rejects.toThrow('Same-origin');
    expect(await save(ctx, null, { hosts: '' })).toContain('not tested');
});

test('SSH streaming uses existing parser, no local refresh and no automatic replay', async () => {
    const ctx = context(); let calls = 0;
    Object.assign(ctx.fns.llm, {
        resolveReasoningEffort: async () => ({ requested: 'auto', applied: 'medium' }),
        toCodexInput: () => ({ input: [] }), codexCliVersion: async () => 'test',
        accountAuthHealth: async () => {},
        refreshCodex: () => { throw new Error('LOCAL CREDENTIAL ACCESS'); },
        connectFetch: () => { throw new Error('LOCAL HTTP'); },
    });
    ctx.fns.agent = { buildLlmRequest: async () => ({ system: '', messages: [] }), cacheRoot: async () => 'test', wireTools: () => [] };
    ctx.fns.sshCli.fetch = async (opts: any) => { calls++; expect(opts.init.headers.authorization).toBeUndefined(); throw new Error('SSH disconnected after request'); };
    await expect(stream(ctx, null, { agent: { id: 'test', model: 'ssh-codex/gpu:gpt-5.4' } as any })).rejects.toThrow('SSH disconnected');
    expect(calls).toBe(1);
});

test('remote bridge keeps credential protection and endpoint restriction', () => {
    const script = bridge(context(), null, {});
    for (const marker of ['flock', 'os.replace', 'os.path.islink', 'NoRedirect', "a!='default'", 'Unsupported SSH CLI request', "'cookie'", "'authorization'"]) expect(script).toContain(marker);
});

test('Claude route, reasoning and compaction use the remote CLI family', async () => {
    const ctx = context();
    expect(await resolveEndpoint(ctx, null, { model: 'ssh-claude-code/gpu:claude-sonnet-4-6' })).toMatchObject({ api: 'anthropic', apiKey: null, provider: 'ssh-claude-code' });
    expect(await capabilities(ctx, null, { model: 'ssh-claude-code/gpu:claude-sonnet-4-6' })).toEqual(await capabilities(ctx, null, { model: 'claude-code:claude-sonnet-4-6' }));
    expect(() => compaction(ctx, null, { model: 'ssh-claude-code/gpu:claude-sonnet-4-6' })).toThrow('not supported');
});

import anthropic from '../llm/streamAnthropic';
import parseSSE from '../llm/parseSSE';
import buildRequest from '../agent/buildLlmRequest';

test('Claude Code identity is preserved by the real request builder', async () => {
    const ctx = context();
    ctx.fns.agent = { fullSystemPrompt: async () => 'Hyper system', normalizeSleepContext: () => null };
    ctx.fns.session = { repairToolPairs: ({ messages }: any) => ({ messages, repaired: [] }) };
    ctx.fns.auth = { attributeMessages: async ({ messages }: any) => ({ messages, applied: false }) };
    ctx.fns.attachments = { resolveContent: async ({ messages }: any) => messages };
    const out = await buildRequest(ctx, null, { agent: { id: 't', model: 'ssh-claude-code/gpu:claude-sonnet-4-6', messages: [] } as any });
    expect(out.system).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
});

for (const provider of ['codex', 'claude-code'] as const) {
    const model = provider === 'codex' ? 'ssh-codex/gpu:gpt-5.4' : 'ssh-claude-code/gpu:claude-sonnet-4-6';
    const run = provider === 'codex' ? stream : anthropic;
    for (const mode of ['complete', 'early-eof', 'malformed'] as const) test(`${provider} ${mode}: streamed parser, remote auth only, transport cleanup`, async () => {
        const ctx = context(); ctx.env = {}; let cancelled = false;
        Object.assign(ctx.fns.llm, {
            resolveReasoningEffort: async () => ({ requested: 'auto', applied: 'medium', mode: 'none' }),
            toCodexInput: () => ({ input: [] }), toAnthropicMessages: () => [],
            codexCliVersion: async () => 'test', claudeCodeCliVersion: async () => 'test', accountAuthHealth: async () => {},
            refreshCodex: () => { throw new Error('LOCAL AUTH'); }, refreshClaudeCode: () => { throw new Error('LOCAL AUTH'); },
            connectFetch: () => { throw new Error('LOCAL HTTP'); },
            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
        });
        ctx.fns.agent = { buildLlmRequest: async () => ({ system: 'identity', messages: [] }), cacheRoot: async () => 'test', wireTools: () => [] };
        const delta = provider === 'codex' ? 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n' : 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hello"}}\n\n';
        const terminal = provider === 'codex' ? 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n' : 'event: message_stop\ndata: {}\n\n';
        ctx.fns.sshCli.fetch = async (opts: any) => {
            expect(opts.provider).toBe(provider); expect(opts.init.headers.authorization).toBeUndefined(); expect(opts.init.headers['x-api-key']).toBeUndefined();
            if (provider === 'claude-code') { expect(opts.init.headers['anthropic-beta']).toContain('oauth-2025-04-20'); expect(opts.init.headers['x-app']).toBe('cli'); }
            return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(mode === 'malformed' ? 'data: {bad}\n\n' : delta + (mode === 'complete' ? terminal : ''))); if (mode !== 'malformed') c.close(); }, cancel() { cancelled = true; } }));
        };
        if (mode === 'complete') expect((await run(ctx, null, { agent: { id: 't', model } as any })).text).toBe('hello');
        else await expect(run(ctx, null, { agent: { id: 't', model } as any })).rejects.toThrow(mode === 'malformed' ? 'Malformed' : 'terminal event');
        if (mode === 'malformed') expect(cancelled).toBe(true);
    });
}

import picker from '../agent/modelPickerHtml';
test('actual picker preserves both providers and two enabled SSH hosts', async () => {
    const ctx = context();
    ctx.fns.llm.listModels = async () => Object.fromEntries(['ssh-codex', 'ssh-claude-code'].flatMap(p => ['gpu', 'work'].map(h => [`${p}/${h}`, [`${p}/${h}:model-test`]])));
    ctx.fns.llm.listAccounts = async () => [];
    ctx.fns.node = { list: async () => [] };
    ctx.fns.ui.modelLogo = () => '';
    ctx.fns.procs.ui.button = (opts: any) => `<button ${Object.entries(opts.attrs ?? {}).map(([k,v]) => `${k}="${v}"`).join(' ')}>${opts.html ?? opts.label ?? ''}</button>`;
    const html = await picker(ctx, { user: { role: 'owner' } }, { current: '', mode: 'form' });
    for (const p of ['ssh-codex', 'ssh-claude-code']) for (const h of ['gpu', 'work']) expect(html).toContain(`data-model-route="${p}/${h}:model-test"`);
    expect(html).not.toContain('data-model-route="ssh-codex:model-test"');
    const member = await picker(ctx, { user: { role: 'member' } }, { current: 'ssh-codex/gpu:model-test', mode: 'form' });
    expect(member).not.toContain('data-model-route="ssh-');
});

import listModels from '../llm/listModels';
test('catalogue filters per caller after shared cache without mutating it', async () => {
    const ctx = context();
    const value = { 'ssh-codex/gpu': ['ssh-codex/gpu:gpt-5.4'], 'ssh-claude-code/work': ['ssh-claude-code/work:claude-sonnet-4-6'], mock: ['mock:test'] };
    ctx.state.llmModelCatalog = { all: { at: Date.now(), value } };
    const member = await listModels(ctx, { user: { role: 'member' } }, {});
    expect(Object.keys(member)).toEqual(['mock']);
    expect(await listModels(ctx, { user: { role: 'owner' } }, {})).toEqual(value);
    expect(await listModels(ctx, { user: { role: 'member' } }, {})).toEqual(member);
    expect(Object.keys(value)).toHaveLength(3);
});
