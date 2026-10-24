import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import load from './load';

const dir = mkdtempSync(join(tmpdir(), 'repl-load-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fnFile = (name: string, value: string) => {
    const abs = join(dir, `${name}.ts`);
    writeFileSync(abs, `export default async function () { return ${JSON.stringify(value)}; }\n`);
    return { kind: 'fn', moduleDir: 'demo', runtimeName: name, rel: `demo/${name}.ts`, abs, namespace: '' };
};

// A ctx whose scan counts its calls; no fn loader installed, so load falls back to setPath.
function mkCtx(entries: any[]) {
    let scans = 0;
    const ctx: any = {
        state: { registry: {}, procs: { boot: {} } },
        fns: { procs: { project: { scan: async () => { scans++; return entries; } }, log: { info: () => {}, warn: () => {} } } },
    };
    return { ctx, scans: () => scans };
}

test('a module reload scans the project once, however many functions it has', async () => {
    const entries = [fnFile('a', 'A'), fnFile('b', 'B'), fnFile('c', 'C'), { kind: 'fn', moduleDir: 'other', runtimeName: 'x' }];
    const { ctx, scans } = mkCtx(entries);
    const result = await load(ctx, null, { name: 'demo' });
    expect(result).toEqual({ reloaded: 'demo', count: 3, fns: ['a', 'b', 'c'] });
    expect(scans()).toBe(1);
    expect(await ctx.state.registry.demo.b(ctx, null, {})).toBe('B');
});

test('a single-function reload scans once and loads the current file', async () => {
    const entry = fnFile('one', 'v1');
    const { ctx, scans } = mkCtx([entry]);
    expect(await load(ctx, null, { name: 'demo.one' })).toEqual({ reloaded: 'demo.one' });
    expect(scans()).toBe(1);
    expect(await ctx.state.registry.demo.one(ctx, null, {})).toBe('v1');
    fnFile('one', 'v2');
    await Bun.sleep(2); // the import cache key is ?t=<ms>: two reloads in one millisecond share it
    await load(ctx, null, { name: 'demo.one' });
    expect(await ctx.state.registry.demo.one(ctx, null, {})).toBe('v2');
});

test('an unknown function is reported by name', async () => {
    const { ctx } = mkCtx([]);
    await expect(load(ctx, null, { name: 'demo.missing' })).rejects.toThrow('no file for demo/missing');
});
