import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCtx } from '../$test';

/** USER_PLUGINS with one plugin `clonedemo` (namespace clonedemo, one function). */
function userRoot() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-watch-')));
    const plugin = join(root, 'clonedemo');
    mkdirSync(join(plugin, 'src', 'clonedemo'), { recursive: true });
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'clonedemo', type: 'module', procs: { src: 'src' } }));
    const fn = (body: string) => writeFileSync(join(plugin, 'src', 'clonedemo', 'hello.ts'),
        `export default async function (_ctx: Context, _session: Session | null, _opts: {}) { ${body} }\n`);
    fn('return "v1";');
    return { root, plugin, fn };
}

test('reloadCloneFiles: a saved function goes live, a broken one stays old and lands on the error board', async () => {
    const u = userRoot();
    try {
        const ctx: any = await testCtx({ env: { USER_PLUGINS: u.root } });
        expect(await ctx.fns.clonedemo.hello({})).toBe('v1');
        const file = join(u.plugin, 'src', 'clonedemo', 'hello.ts');
        u.fn('return "v2";');
        let r = await ctx.fns.plugins.reloadCloneFiles({ files: [file, join(u.plugin, 'node_modules', 'x', 'y.ts'), join(u.plugin, 'README.md')] });
        expect(r.reloaded).toEqual(['clonedemo.hello']);
        expect(await ctx.fns.clonedemo.hello({})).toBe('v2');

        u.fn('return ((;');
        r = await ctx.fns.plugins.reloadCloneFiles({ files: [file] });
        expect(Object.keys(r.errors)).toEqual(['clonedemo/src/clonedemo/hello.ts']);
        expect(ctx.state.procs.dev.errors.has('clonedemo/src/clonedemo/hello.ts')).toBe(true);
        expect(await ctx.fns.clonedemo.hello({})).toBe('v2');

        u.fn('return "v3";');
        r = await ctx.fns.plugins.reloadCloneFiles({ files: [file] });
        expect(r.errors).toEqual({});
        expect(ctx.state.procs.dev.errors.has('clonedemo/src/clonedemo/hello.ts')).toBe(false);
        expect(await ctx.fns.clonedemo.hello({})).toBe('v3');
    } finally {
        rmSync(u.root, { recursive: true, force: true });
    }
});

test('watchClones: a save under USER_PLUGINS is debounced into one reload; stop closes it', async () => {
    const u = userRoot();
    try {
        const ctx: any = await testCtx({ env: { USER_PLUGINS: u.root } });
        const batches: string[][] = [];
        const real = ctx.fns.plugins.reloadCloneFiles;
        ctx.state.registry.plugins.reloadCloneFiles = async (_c: any, _s: any, o: any) => { batches.push(o.files); return real(o); };
        expect((await ctx.fns.plugins.watchClones({ debounceMs: 100 })).status).toBe('started');
        expect((await ctx.fns.plugins.watchClones({})).status).toBe('already');
        await Bun.sleep(100);
        u.fn('return "w1";');
        u.fn('return "w2";');
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && (await ctx.fns.clonedemo.hello({})) !== 'w2') await Bun.sleep(50);
        expect(await ctx.fns.clonedemo.hello({})).toBe('w2');
        expect(batches.length).toBe(1);
        expect((await ctx.fns.plugins.watchClones({ stop: true })).status).toBe('stopped');
    } finally {
        rmSync(u.root, { recursive: true, force: true });
    }
});
