import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bunInstall from './bunInstall';
import inspectPackage from './inspectPackage';
import listing from './listing';
import versions from './versions';
import catalog from './catalog';
import install from './install';
import uninstall from './uninstall';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
}

/** Local git repos (base; chart requires base; lonely requires missing), a file:// listing and an empty host. */
async function world() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugins-install-')));
    roots.push(root);
    const repo = async (name: string, releases: string[], requires: string[] = []) => {
        const dir = join(root, 'repos', name);
        await mkdir(join(dir, 'src', name), { recursive: true });
        git(dir, 'init', '-q');
        for (const v of releases) {
            await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: v, procs: { requires } }));
            await writeFile(join(dir, 'src', name, 'version.ts'), `export default async () => ${JSON.stringify(v)};`);
            git(dir, 'add', '-A'); git(dir, 'commit', '-qm', v); git(dir, 'tag', 'v' + v);
        }
        git(dir, 'tag', 'nightly');
        return { name, label: name, description: `the ${name} plugin`, source: `git+file://${dir}` };
    };
    const entries = [await repo('base', ['1.0.0', '1.2.0', '1.10.0']), await repo('chart', ['2.0.0'], ['base']), await repo('lonely', ['1.0.0'], ['missing'])];
    const index = join(root, 'index.json');
    await writeFile(index, JSON.stringify({ format: 2, plugins: entries }));
    const host = join(root, 'host');
    const ctx: any = {
        env: { PLUGIN_HOST: host, HOME: root },
        state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
        fns: {
            settings: { get: async () => ['file://' + index] },
            procs: { modules: { reload: async () => {} } },
            plugins: {},
        },
    };
    for (const [k, f] of Object.entries({ bunInstall, inspectPackage, listing, versions, catalog, install, uninstall }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const deps = async () => JSON.parse(await readFile(join(host, 'package.json'), 'utf8')).dependencies ?? {};
    return { ctx, host, deps };
}

test('versions: semver tags only, newest first by number', async () => {
    const w = await world();
    const ctx = w.ctx;
    const { plugins } = await ctx.fns.plugins.listing({});
    const list = await ctx.fns.plugins.versions({ source: plugins[0].source });
    expect(list.map((t: any) => t.version)).toEqual(['1.10.0', '1.2.0', '1.0.0']);
    expect(list[0].commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(ctx.fns.plugins.versions({ source: 'https://example.org/x' })).rejects.toThrow('Unsupported');
});

test('install pulls in required plugins from the listing; catalog shows state; uninstall guards dependents', async () => {
    const w = await world();
    const ctx = w.ctx;
    let cat = await ctx.fns.plugins.catalog({ q: 'chart' });
    expect(cat.plugins.map((p: any) => [p.name, p.latest, p.installed ?? null])).toEqual([['chart', '2.0.0', null]]);

    const preview = await ctx.fns.plugins.install({ name: 'chart' });
    expect(preview.status).toBe('preview');
    expect(preview.spec).toEndWith('#v2.0.0');
    expect(preview.companions?.map((c: any) => [c.name, c.version])).toEqual([['base', '1.10.0']]);
    expect(await w.deps()).toEqual({});
    await ctx.fns.plugins.install({ name: 'chart', confirmed: true, expectedDigest: preview.digest });
    expect(Object.keys(await w.deps()).sort()).toEqual(['base', 'chart']);

    cat = await ctx.fns.plugins.catalog({});
    const base = cat.plugins.find((p: any) => p.name === 'base');
    expect([base.installed, base.latest, base.update]).toEqual(['1.10.0', '1.10.0', false]);
    expect(cat.plugins.find((p: any) => p.name === 'chart').requires).toEqual(['base']);

    await expect(ctx.fns.plugins.uninstall({ name: 'base' })).rejects.toThrow('base is required by chart');
    w.ctx.state.registry = { chart: { version: () => '2.0.0' }, base: { version: () => '1.10.0' } };
    w.ctx.state.markdown = { fences: { chartlang: { module: 'chart' }, mermaid: { module: 'other' } } };
    const gone = await ctx.fns.plugins.uninstall({ name: 'chart' });
    await ctx.fns.plugins.uninstall({ name: 'chart', confirmed: true, expectedDigest: gone.digest });
    expect(Object.keys(w.ctx.state.registry)).toEqual(['base']);       // no longer callable without a restart
    expect(Object.keys(w.ctx.state.markdown.fences)).toEqual(['mermaid']);
    expect(Object.keys(await w.deps())).toEqual(['base']);
});

test('an older release, then update to the newest; a requirement missing from the listing is named', async () => {
    const w = await world();
    const ctx = w.ctx;
    const old = await ctx.fns.plugins.install({ name: 'base', version: '1.2.0' });
    await ctx.fns.plugins.install({ name: 'base', version: '1.2.0', confirmed: true, expectedDigest: old.digest });
    expect((await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0]).toMatchObject({ installed: '1.2.0', latest: '1.10.0', update: true });
    const up = await ctx.fns.plugins.install({ name: 'base' });
    expect(up.operation).toBe('update');
    expect(up.changed).toEqual(['package.json', 'src/base/version.ts']);
    await ctx.fns.plugins.install({ name: 'base', confirmed: true, expectedDigest: up.digest });
    expect((await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0].update).toBe(false);

    await expect(ctx.fns.plugins.install({ name: 'lonely' })).rejects.toThrow('lonely requires missing, which is neither installed nor in the listing');
    await expect(ctx.fns.plugins.install({ name: 'base', version: '9.9.9' })).rejects.toThrow('no release 9.9.9');
    await expect(ctx.fns.plugins.install({ name: 'nope' })).rejects.toThrow('not in the plugin listing');
});

test('several listings: merged in order, first wins on a name, a broken one does not hide the others', async () => {
    const w = await world();
    const ctx = w.ctx;
    const dir = join(w.host, '..');
    const good = { name: 'demo', label: 'Demo', description: 'd', source: 'github:o/demo' };
    const a = 'file://' + join(dir, 'a.json'), b = 'file://' + join(dir, 'b.json');
    await writeFile(join(dir, 'a.json'), JSON.stringify({ format: 2, plugins: [good, { ...good, name: 'bad', source: 'npm:x' }, good] }));
    await writeFile(join(dir, 'b.json'), JSON.stringify({ format: 2, plugins: [{ ...good, source: 'github:other/demo' }, { ...good, name: 'extra' }] }));
    await writeFile(join(dir, 'old.json'), JSON.stringify({ format: 1, plugins: [] }));
    const r = await ctx.fns.plugins.listing({ urls: [a, 'file://' + join(dir, 'old.json'), b, 'http://example.org/index.json'] });
    expect(r.plugins.map((p: any) => [p.name, p.source, p.listing])).toEqual([['demo', 'github:o/demo', a], ['extra', 'github:o/demo', b]]);
    expect(r.errors).toEqual([
        `bad: invalid entry in ${a}`, `demo: duplicate in ${a}`,
        `file://${join(dir, 'old.json')}: Listing must be { format: 2, plugins: [...] }`,
        `demo: also in ${b}; the entry of ${a} is used`,
        'http://example.org/index.json: Listing URL must be https:// or file://',
    ]);
    // The setting may be one string from env PLUGIN_LISTINGS: commas or spaces between addresses.
    ctx.fns.settings.get = async () => `${a}, ${b}`;
    expect((await ctx.fns.plugins.catalog({ q: 'extra' })).urls).toEqual([a, b]);
    // A listing on this machine may point at local repositories (a remote one may not).
    await writeFile(join(dir, 'a.json'), JSON.stringify({ format: 2, plugins: [{ ...good, source: 'git+file:///tmp/x' }] }));
    expect((await ctx.fns.plugins.listing({ urls: [a] })).plugins.length).toBe(1);
});

test('updating a plugin the host itself mounts is not a namespace collision (module dir = package dir or its src)', async () => {
    const w = await world();
    const ctx = w.ctx;
    const first = await ctx.fns.plugins.install({ name: 'base', version: '1.0.0' });
    await ctx.fns.plugins.install({ name: 'base', version: '1.0.0', confirmed: true, expectedDigest: first.digest });
    const dir = join(w.host, 'node_modules', 'base');
    for (const mounted of [dir, join(dir, 'src')]) {
        w.ctx.state.procs.modules = [{ name: 'base', dir: mounted, namespaces: ['base'] }];
        expect((await ctx.fns.plugins.install({ name: 'base' })).operation).toBe('update');
    }
    w.ctx.state.procs.modules = [{ name: 'base', dir: join(w.host, '..', 'elsewhere', 'base'), namespaces: ['base'] }];
    await expect(ctx.fns.plugins.install({ name: 'base' })).rejects.toThrow('Namespace collision: base is provided by base');
});
