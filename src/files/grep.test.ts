import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const DIR = '/tmp/hyper-grep-test';

beforeAll(async () => {
    await rm(DIR, { recursive: true, force: true });
    await mkdir(`${DIR}/src`, { recursive: true });
    await mkdir(`${DIR}/node_modules/pkg`, { recursive: true });
    await writeFile(`${DIR}/.gitignore`, 'ignored.txt\nnode_modules/\n');
    await writeFile(`${DIR}/src/a.ts`, 'const alpha = 1;\nconst Beta = 2;\nconst gamma = alpha + 1;\n');
    await writeFile(`${DIR}/src/b.ts`, 'export const alpha = "x";\n');
    await writeFile(`${DIR}/ignored.txt`, 'alpha lives here too\n');
    await writeFile(`${DIR}/node_modules/pkg/index.js`, 'const alpha = 99;\n');
    await writeFile(`${DIR}/src/re.ts`, 'const price = a.b(c);\n');
});
afterAll(async () => { await rm(DIR, { recursive: true, force: true }); });

// grep and find are no longer declared as model-facing tools (the model uses
// bash + ripgrep). The implementations stay, callable by hand and from eval —
// this is that call path, with tools.call's agent-scoped ctx reproduced.
const callTool = async (ctx: any, name: 'grep' | 'find', args: any, agent?: any) => {
    let c = ctx;
    if (agent) { c = Object.create(ctx); c.session = ctx.fns.session.forAgent({ agent }); }
    try { return { output: String(await c.fns.tools[name](args)), isError: false }; }
    catch (e: any) { return { output: `Error: ${e?.message ?? e}`, isError: true }; }
};

const at = async () => {
    const ctx: any = await mkTestCtx();
    ctx.fns.files.resolveSafe = (_c: any, _s: any, o: any) => o.path ? `${DIR}/${o.path}` : DIR;
    ctx.fns.files.read = async (_c: any, _s: any, o: any) => await Bun.file(`${DIR}/${o.path}`).text();
    return ctx;
};

describe('files.grep', () => {
    test('finds matches with path, line and column', async () => {
        const ctx = await at();
        const rows = await ctx.fns.files.grep({ pattern: 'alpha', path: 'src' });
        expect(rows.map((r: any) => `${r.path}:${r.line}:${r.column}`).sort())
            .toEqual(['src/a.ts:1:7', 'src/a.ts:3:15', 'src/b.ts:1:14']);
    });

    test('is case-sensitive by default and honours ignoreCase', async () => {
        const ctx = await at();
        expect(await ctx.fns.files.grep({ pattern: 'beta', path: 'src' })).toHaveLength(0);
        expect(await ctx.fns.files.grep({ pattern: 'beta', path: 'src', ignoreCase: true })).toHaveLength(1);
    });

    test('literal searches text that would otherwise be a regex', async () => {
        const ctx = await at();
        expect(await ctx.fns.files.grep({ pattern: 'a.b(c)', path: 'src', literal: true })).toHaveLength(1);
        // as a regex the same string matches nothing here
        expect(await ctx.fns.files.grep({ pattern: 'a\\.b\\(c\\)x', path: 'src' })).toHaveLength(0);
    });

    test('respects .gitignore, and noIgnore searches everywhere', async () => {
        const ctx = await at();
        const paths = (await ctx.fns.files.grep({ pattern: 'alpha' })).map((r: any) => r.path);
        expect(paths).not.toContain('ignored.txt');
        expect(paths.some((p: string) => p.includes('node_modules'))).toBe(false);

        const all = (await ctx.fns.files.grep({ pattern: 'alpha', noIgnore: true })).map((r: any) => r.path);
        expect(all).toContain('ignored.txt');
    });

    test('limit stops the search, context attaches neighbouring lines', async () => {
        const ctx = await at();
        expect(await ctx.fns.files.grep({ pattern: 'alpha', limit: 1 })).toHaveLength(1);

        const [hit] = await ctx.fns.files.grep({ pattern: 'gamma', path: 'src', context: 1 });
        expect(hit.before).toEqual(['const Beta = 2;']);
        expect(hit.after).toEqual(['']);
    });

    test('a broken regex is reported, not swallowed', async () => {
        const ctx = await at();
        expect(ctx.fns.files.grep({ pattern: '(unclosed', path: 'src' })).rejects.toThrow();
    });
});

describe('grep tool output', () => {
    test('says when it hit the limit', async () => {
        const ctx = await at();
        const out = await callTool(ctx, 'grep', { pattern: 'alpha', limit: 1 });
        expect(out.output).toContain('stopped at the limit of 1 matches');
    });

    test('complains loudly when ripgrep is missing', async () => {
        const ctx = await at();
        ctx.fns.files.rgPath = () => null;
        const out = await callTool(ctx, 'grep', { pattern: 'alpha', path: 'src' });
        expect(out.output).toContain('ripgrep (rg) is not installed');
        expect(out.output).toContain('brew install ripgrep');
        // …and still returns the matches, from the fallback scan
        expect(out.output).toContain('src/a.ts:1:7: const alpha = 1;');
    });

    test('the fallback scan agrees with ripgrep', async () => {
        const ctx = await at();
        const withRg = await ctx.fns.files.grep({ pattern: 'alpha', path: 'src' });
        ctx.fns.files.rgPath = () => null;
        const without = await ctx.fns.files.grep({ pattern: 'alpha', path: 'src' });
        expect(without.map((r: any) => `${r.path}:${r.line}:${r.column}|${r.text}`).sort())
            .toEqual(withRg.map((r: any) => `${r.path}:${r.line}:${r.column}|${r.text}`).sort());
    });
});

describe('grep is rooted in the agent workspace', () => {
    test('with no path it searches the workspace, not the server cwd', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const r = await callTool(ctx, 'grep', { pattern: 'alpha' }, agent);
        expect(r.output).toContain('src/a.ts:1:7: const alpha = 1;');
        // the repo this test runs from also contains "alpha" nowhere near src/a.ts
        expect(r.output).not.toContain('/Users/');
    });

    test('path overrides it — relative under the workspace, absolute anywhere', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const rel = await callTool(ctx, 'grep', { pattern: 'alpha', path: 'src' }, agent);
        expect(rel.output).toContain('src/b.ts');
        expect(rel.output).not.toContain('ignored.txt');

        const abs = await callTool(ctx, 'grep', { pattern: 'alpha', path: `${DIR}/src` }, agent);
        expect(abs.output).toContain('b.ts:1:14:');
    });

    test('an agent with no workspace falls back to the server cwd', async () => {
        const ctx: any = await mkTestCtx();
        const r = await callTool(ctx, 'grep', { pattern: 'rgPath', path: 'src/files/rgPath.ts', limit: 2 });
        expect(r.output).toContain('src/files/rgPath.ts');
    });
});

describe('grep regressions found by the agent', () => {
    test('path may name a single file, not just a directory', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const r = await callTool(ctx, 'grep', { pattern: 'alpha', path: 'src/b.ts' }, agent);
        expect(r.isError).toBe(false);
        expect(r.output).toContain('src/b.ts:1:14: export const alpha');
        expect(r.output).not.toContain('a.ts');

        // …and the fallback scan agrees (same workspace, so pass the agent)
        ctx.fns.files.rgPath = () => null;
        const fb = await callTool(ctx, 'grep', { pattern: 'alpha', path: 'src/b.ts' }, agent);
        expect(fb.output).toContain('src/b.ts:1:14: export const alpha');
        expect(fb.output).not.toContain('a.ts');
    });

    test('a broken regex keeps ripgrep own diagnosis', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const r = await callTool(ctx, 'grep', { pattern: '[' }, agent);
        expect(r.isError).toBe(true);
        expect(r.output).toContain('regex parse error');
        // the useful part lives on the lines AFTER the first one
        expect(r.output.split('\n').length).toBeGreaterThan(1);
    });

    test('context lines carry their own line numbers', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const r = await callTool(ctx, 'grep', { pattern: 'gamma', path: 'src', context: 1 }, agent);
        expect(r.output).toContain('src/a.ts-2- const Beta = 2;');
        expect(r.output).toContain('src/a.ts:3:7: const gamma');
    });

    test('an over-long line is cut and the cut is reported', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;
        await Bun.write(`${DIR}/src/long.ts`, 'const huge = "' + 'x'.repeat(2000) + '";\n');

        const r = await callTool(ctx, 'grep', { pattern: 'const huge', path: 'src' }, agent);
        expect(r.output).toContain('… (+');
        expect(r.output).toContain('some lines were cut at 400 chars');
    });
});

describe('hashline output feeds edit directly', () => {
    test('rows carry anchors instead of line numbers, and the anchor applies', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;
        await Bun.write(`${DIR}/src/hash.ts`, 'const one = 1;\nconst two = 2;\n');

        const r = await callTool(ctx, 'grep', { pattern: 'two', path: 'src/hash.ts', hashline: true }, agent);
        // path:ANCHOR:col: text — the anchor is <line><hash>, not a bare line number
        const row = r.output.split('\n')[0]!;
        const anchor = row.split(':')[1]!;
        expect(anchor).toMatch(/^2[0-9a-z]+$/);

        // the anchor grep printed is the one edit accepts
        const applied = await ctx.fns.tools.call({ name: 'edit', args: {
            path: 'src/hash.ts',
            edits: [{ op: 'replaceLines', anchor, text: 'const two = 22;' }],
        }, agent });
        expect(applied.isError).toBe(false);
        expect(await Bun.file(`${DIR}/src/hash.ts`).text()).toBe('const one = 1;\nconst two = 22;\n');
    });
});

describe('find', () => {
    test('finds files by glob, honours .gitignore, and reports the limit', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        const ts = await callTool(ctx, 'find', { pattern: '*.ts' }, agent);
        expect(ts.output).toContain('src/a.ts');
        expect(ts.output).toContain('src/b.ts');
        expect(ts.output).not.toContain('node_modules');

        const ignored = await callTool(ctx, 'find', { pattern: 'ignored.txt' }, agent);
        expect(ignored.output).toContain('no files matched');

        const everywhere = await callTool(ctx, 'find', { pattern: 'ignored.txt', noIgnore: true }, agent);
        expect(everywhere.output).toContain('ignored.txt');

        const capped = await callTool(ctx, 'find', { pattern: '*.ts', limit: 1 }, agent);
        expect(capped.output).toContain('stopped at the limit of 1 paths');
    });

    test('a search can be given a deadline and returns what it had', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test' });
        agent.workspaceDir = DIR;

        // A deadline that cannot be hit must not change the answer.
        const r = await callTool(ctx, 'grep', { pattern: 'alpha', path: 'src', timeout: 30 }, agent);
        expect(r.isError).toBe(false);
        expect(r.output).toContain('src/a.ts');
    });
});
