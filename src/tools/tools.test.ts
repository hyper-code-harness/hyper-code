import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

async function setup() {
    const ctx: any = await mkTestCtx();
    ctx.fns.files.read = async (_c: any, _s: any, o: any) => ['a', 'b', 'c', 'd'].join('\n');
    ctx.fns.files.readHashline = async (_c: any, _s: any, o: any) => ({ text: `HASH:${o.path}` });
    ctx.fns.files.write = async (c: any, _s: any, o: any) => { ((c.state as any).__written ??= {})[o.path] = o.content; };
    ctx.fns.files.grep = async () => [{ path: 'a.ts', line: 2, column: 3, text: 'foo' }];
    ctx.fns.files.applyEdits = async (_c: any, _s: any, o: any) => ({ path: o.path, bytes: 12 });
    return ctx;
}

describe('tools registry', () => {
    test('$tool_*.md declarations register with their implementation fn', async () => {
        const ctx = await setup();
        const byName = Object.fromEntries(ctx.fns.tools.list({}).map((t: any) => [t.wireName, t]));

        expect(Object.keys(byName).sort()).toEqual(['bash', 'edit', 'eval', 'find', 'grep', 'read', 'respondHtml', 'write']);
        expect(byName.read.fn).toBe('tools.read');
        expect(byName.read.marker).toBe('read');
        expect(byName.read.parameters.required).toEqual(['path']);
        // the markdown body of the declaration becomes the prompt doc
        expect(byName.read.doc).toContain('§result:read:hashline');
    });

    test('call runs the declared fn and reports failures as text, not exceptions', async () => {
        const ctx = await setup();
        expect(await ctx.fns.tools.call({ name: 'read', args: { path: 'x.ts', maxLines: 2 } }))
            .toEqual({ output: 'a\nb', isError: false });

        const ok = await ctx.fns.tools.call({ name: 'edit', args: {
            path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }],
        } });
        expect(ok).toEqual({ output: 'edited a.ts (12 bytes, 1 edit)', isError: false });

        // the text DSL is gone from the tool's surface: it is a marker detail
        const boom = await ctx.fns.tools.call({ name: 'edit', args: { script: '@a.ts' } });
        expect(boom.isError).toBe(true);
        expect(boom.output).toContain('unknown option "script"');
    });

    test('unknown option and missing option are rejected before anything runs', async () => {
        const ctx = await setup();
        let touched = false;
        ctx.fns.tools.read = async () => { touched = true; return 'x'; };

        const typo = await ctx.fns.tools.call({ name: 'read', args: { path: 'x.ts', maxLine: 2 } });
        expect(typo.isError).toBe(true);
        expect(typo.output).toContain('unknown option "maxLine"');
        expect(typo.output).toContain('did you mean "maxLines"');

        const missing = await ctx.fns.tools.call({ name: 'grep', args: {} });
        expect(missing.output).toContain('missing required option "pattern"');
        expect(touched).toBe(false);
    });

    test('unknown tool name comes back as a message the model can act on', async () => {
        const ctx = await setup();
        const r = await ctx.fns.tools.call({ name: 'reed', args: {} });
        expect(r.isError).toBe(true);
        expect(r.output).toContain('unknown tool "reed"');
        expect(r.output).toContain('read');
    });

    test('schemas render the three provider dialects', async () => {
        const ctx = await setup();
        const openai = ctx.fns.tools.schemas({ api: 'openai' }).find((t: any) => t.function.name === 'write');
        expect(openai.function.parameters.additionalProperties).toBe(false);
        expect(openai.function.strict).toBe(true);

        const responses = ctx.fns.tools.schemas({ api: 'responses' }).find((t: any) => t.name === 'write');
        expect(responses).toMatchObject({ type: 'function', name: 'write', strict: true });

        const anthropic = ctx.fns.tools.schemas({ api: 'anthropic' }).find((t: any) => t.name === 'write');
        expect(anthropic.input_schema.required).toEqual(['path', 'content']);
        expect(anthropic.parameters).toBeUndefined();

        // optional options make strict decoding illegal — ship non-strict rather than not at all
        expect(ctx.fns.tools.schemas({ api: 'responses' }).find((t: any) => t.name === 'read').strict).toBe(false);
        // …and OpenAI checks every nested object too: edits[].items has optional
        // fields, which is a 400 if we claim strict (it was, live).
        expect(ctx.fns.tools.schemas({ api: 'responses' }).find((t: any) => t.name === 'edit').strict).toBe(false);
    });
});

describe('prompt assembly', () => {
    test('the tool section is generated from the registry', async () => {
        const ctx = await setup();
        const section = ctx.fns.tools.promptSection({ protocol: 'json' });

        expect(section).toContain('- `read` — read files, whole or by line range');
        // guidelines are merged from the tools that contribute them, deduped
        expect(section).toContain('Read a file in hashline mode before editing it');
    });


    test('the system prompt carries it, and narrowing an agent shrinks the prefix', async () => {
        const ctx = await setup();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });

        const full = await ctx.fns.agent.fullSystemPrompt({ agent });
        expect(full).toContain('## Available tools');
        expect(full).toContain('- `grep` —');

        const narrow = await ctx.fns.agent.fullSystemPrompt({ agent: { ...agent, tools: ['read'] } });
        expect(narrow).toContain('- `read` —');
        expect(narrow).not.toContain('- `grep` —');
        expect(narrow.length).toBeLessThan(full.length);
    });
});

describe('structured edit', () => {
    test('literal and anchored edits compile to engine ops', async () => {
        const ctx: any = await mkTestCtx();
        let seen: any = null;
        ctx.fns.files.applyEdits = async (_c: any, _s: any, o: any) => { seen = o; return { path: o.path, bytes: 9 }; };

        await ctx.fns.tools.call({ name: 'edit', args: {
            path: 'a.ts',
            edits: [{ oldText: 'foo', newText: 'bar' }, { oldText: 'x', newText: 'y', all: true }],
        } });
        expect(seen).toEqual({ path: 'a.ts', ops: [
            { kind: 'literal_replace', old: 'foo', replacement: 'bar', all: false },
            { kind: 'literal_replace', old: 'x', replacement: 'y', all: true },
        ] });

        // anchored edits compile to the engine's anchored ops
        await ctx.fns.tools.call({ name: 'edit', args: {
            path: 'a.ts', edits: [{ op: 'replaceLines', anchor: '22ab', text: 'const x = 1;' }],
        } });
        expect(seen.ops).toEqual([{ kind: 'replace', start: '22ab', end: undefined, lines: ['const x = 1;'] }]);
    });

    test('anchored edits carry their anchor through', async () => {
        const ctx: any = await mkTestCtx();
        let seen: any = null;
        ctx.fns.files.applyEdits = async (_c: any, _s: any, o: any) => { seen = o; return { path: o.path, bytes: 4 }; };

        await ctx.fns.tools.call({ name: 'edit', args: { path: 'a.ts', edits: [
            { op: 'insertAfter', anchor: '3cd', text: 'added' },
            { op: 'delete', anchor: '7ef', endAnchor: '9gh' },
        ] } });
        expect(seen.ops).toEqual([
            { kind: 'insert_after', anchor: '3cd', lines: ['added'] },
            { kind: 'delete', start: '7ef', end: '9gh' },
        ]);
    });

    test('the declared validate fn catches what the schema cannot', async () => {
        const ctx: any = await mkTestCtx();
        let ran = false;
        ctx.fns.files.applyEdits = async () => { ran = true; return { path: 'a.ts', bytes: 1 }; };

        const mixed = await ctx.fns.tools.call({ name: 'edit', args: { path: 'a.ts', edits: [
            { oldText: 'a', newText: 'b' },
            { op: 'delete', anchor: '2xy' },
        ] } });
        expect(mixed.output).toContain('either literal replacements or anchored ops');

        const noop = await ctx.fns.tools.call({ name: 'edit', args: { path: 'a.ts', edits: [{ oldText: 'a', newText: 'a' }] } });
        expect(noop.output).toContain('replaces text with itself');

        const empty = await ctx.fns.tools.call({ name: 'edit', args: { path: 'a.ts', edits: [] } });
        expect(empty.output).toContain('`edits` is empty');
        expect(ran).toBe(false);
    });

    test('nested schema errors name the exact path', async () => {
        const ctx: any = await mkTestCtx();
        const r = await ctx.fns.tools.call({ name: 'edit', args: {
            path: 'a.ts', edits: [{ oldText: 'a', newTxt: 'b' }],
        } });
        expect(r.output).toContain('unknown option "edits[0].newTxt"');
        expect(r.output).toContain('did you mean "newText"');

        const wrongType = await ctx.fns.tools.call({ name: 'edit', args: { path: 'a.ts', edits: 'nope' } });
        expect(wrongType.output).toContain('"edits" must be an array, got string');
    });
});

describe('bash options', () => {
    test('cwd, env, secrets and timeout reach the shell', async () => {
        const ctx: any = await mkTestCtx();

        const pwd = await ctx.fns.tools.call({ name: 'bash', args: { command: 'pwd', cwd: '/tmp' } });
        expect(pwd.output).toContain('/tmp');

        const env = await ctx.fns.tools.call({ name: 'bash', args: { command: 'echo "[$HYPER_TEST]"', env: { HYPER_TEST: 'yes' } } });
        expect(env.output).toContain('[yes]');

        ctx.env.HYPER_SECRET_TEST = 'very-secret-value';
        const secret = await ctx.fns.tools.call({ name: 'bash', args: {
            command: 'printf "%s" "$TOKEN"',
            env: { TOKEN: 'ordinary' },
            secrets: { TOKEN: 'env://HYPER_SECRET_TEST' },
        } });
        expect(secret).toEqual({ output: '[REDACTED]', isError: false });
        expect(secret.output).not.toContain('very-secret-value');

        const slow = await ctx.fns.tools.call({ name: 'bash', args: { command: 'echo starting; sleep 5', timeout: 1 } });
        expect(slow.isError).toBe(true);
        expect(slow.output).toContain('timed out after 1s');
        expect(slow.output).toContain('starting');
    });

    test('secrets reject literals, invalid env names and missing refs', async () => {
        const ctx: any = await mkTestCtx();

        const literal = await ctx.fns.tools.call({ name: 'bash', args: {
            command: 'true', secrets: { TOKEN: 'plaintext' },
        } });
        expect(literal.isError).toBe(true);
        expect(literal.output).toContain('must be an op://, env:// or secret:// reference');

        const badName = await ctx.fns.tools.call({ name: 'bash', args: {
            command: 'true', secrets: { 'BAD-NAME': 'env://TOKEN' },
        } });
        expect(badName.output).toContain('invalid secret environment variable');

        const missing = await ctx.fns.tools.call({ name: 'bash', args: {
            command: 'true', secrets: { TOKEN: 'env://HYPER_MISSING_SECRET' },
        } });
        expect(missing.output).toContain('could not be resolved');
    });


    test('redacts resolved secrets from both stdout and stderr', async () => {
        const ctx: any = await mkTestCtx();
        ctx.env.HYPER_SECRET_TEST = 'secret-with-special-$-chars';

        const result = await ctx.fns.tools.call({ name: 'bash', args: {
            command: 'printf "%s" "$TOKEN"; printf "%s" "$TOKEN" >&2; exit 3',
            secrets: { TOKEN: 'env://HYPER_SECRET_TEST' },
        } });

        expect(result.isError).toBe(true);
        expect(result.output).toContain('stdout:\n[REDACTED]');
        expect(result.output).toContain('[REDACTED]');
        expect(result.output).not.toContain('secret-with-special-$-chars');
    });

    test('a relative cwd resolves against the agent workspace', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = '/tmp';

        const r = await ctx.fns.tools.call({ name: 'bash', args: { command: 'pwd', cwd: '.' }, agent });
        expect(r.output).toContain('/tmp');
    });
});

test("read returns an image path as model-visible image content", async () => {
    const { testCtx } = await import("../$test");
    const ctx = await testCtx();
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
    const path = `/tmp/read-image-${Date.now()}.png`;
    await Bun.write(path, png);
    const r: any = await ctx.fns.tools.read({ path });
    expect(r.output).toBe(`[image: ${path}]`);
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
});
