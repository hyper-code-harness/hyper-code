import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import inspectPackage from './inspectPackage';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/** Bare repos `demo` (v1.0.0, v2.0.0) and `needy` (requires demo), pushed from a work copy; an empty USER_PLUGINS. */
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-install-')));
    roots.push(root);
    const repo = async (name: string, releases: Array<{ v: string; body: string; extra?: Record<string, string> }>, requires: string[] = []) => {
        const bare = join(root, 'remotes', name + '.git');
        const work = join(root, 'work', name);
        await mkdir(bare, { recursive: true });
        git(bare, 'init', '-q', '--bare');
        await mkdir(join(work, 'src', name), { recursive: true });
        git(work, 'init', '-q', '-b', 'main');
        for (const r of releases) {
            await writeFile(join(work, 'package.json'), JSON.stringify({ name, version: r.v, type: 'module', procs: { src: 'src', requires } }));
            await writeFile(join(work, 'src', name, 'hello.ts'), `export default async () => ${JSON.stringify(r.body)};`);
            for (const [f, c] of Object.entries(r.extra ?? {})) await writeFile(join(work, f), c);
            git(work, 'add', '-A'); git(work, 'commit', '-qm', r.v); git(work, 'tag', 'v' + r.v);
        }
        git(work, 'push', '-q', '--tags', bare, 'main');
        return 'git+file://' + bare;
    };
    const demo = await repo('demo', [{ v: '1.0.0', body: 'v1' }, { v: '2.0.0', body: 'v2', extra: { 'NOTES.md': 'new' } }]);
    const needy = await repo('needy', [{ v: '1.0.0', body: 'needy' }], ['demo']);
    const user = join(root, 'hyper', 'user');
    let reloads = 0;
    const ctx: any = {
        env: { USER_PLUGINS: user, HOME: root },
        state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
        fns: { plugins: {}, procs: { modules: { reload: async () => { reloads++; } } } },
    };
    for (const [k, f] of Object.entries({ inspectPackage, lockFile, cloneStatus })) ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const call = (o: any) => gitInstall(ctx, null, o);
    const confirm = async (o: any) => call({ ...o, confirmed: true, expectedDigest: (await call(o)).digest });
    const hello = async (n = 'demo') => (await import(join(user, n, 'src', n, 'hello.ts') + '?t=' + Math.random())).default();
    const lock = async () => JSON.parse(await readFile(join(root, 'hyper', 'plugins.lock.json'), 'utf8'));
    return { root, user, demo, needy, ctx, call, confirm, hello, lock, reloads: () => reloads };
}

test('install clones the tag after a preview bound to the commit; update, rollback and the lock follow', async () => {
    const f = await fixture();
    const preview = await f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0' });
    expect(preview).toMatchObject({ status: 'preview', name: 'demo', tag: 'v1.0.0', plugin: { namespaces: ['demo'], version: '1.0.0' } });
    expect(preview.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(preview.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(preview.added).toEqual(['package.json', 'src/demo/hello.ts']);
    expect(await readdir(f.user)).toEqual([]);
    await expect(f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0', confirmed: true, expectedDigest: 'x' })).rejects.toThrow('digest');
    await expect(f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0', commit: '0'.repeat(40) })).rejects.toThrow('points at');
    const applied = await f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0', confirmed: true, expectedDigest: preview.digest });
    expect(applied.status).toBe('applied');
    expect(f.reloads()).toBe(1);
    expect(await f.hello()).toBe('v1');
    expect(git(join(f.user, 'demo'), 'remote', 'get-url', 'origin')).toBe(f.demo.slice(4));
    expect((await f.lock()).plugins.demo).toEqual({ repo: f.demo, tag: 'v1.0.0', commit: preview.commit, previous: [] });
    await expect(f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v2.0.0' })).rejects.toThrow('already installed');
    // Staging lives beside USER_PLUGINS and is cleaned up.
    expect(await readdir(join(f.root, 'hyper', '.plugin-staging'))).toEqual([]);

    const update = await f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0' });
    expect(update.added).toEqual(['NOTES.md']);
    expect(update.changed).toEqual(['package.json', 'src/demo/hello.ts']);
    expect(update.from).toEqual({ commit: preview.commit!, tag: 'v1.0.0' });
    expect(update.diffStat ?? "").toContain('NOTES.md');
    expect(await f.hello()).toBe('v1');
    await f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0', confirmed: true, expectedDigest: update.digest });
    expect(await f.hello()).toBe('v2');
    expect((await f.lock()).plugins.demo).toMatchObject({ tag: 'v2.0.0', previous: [{ tag: 'v1.0.0', commit: preview.commit }] });

    const rollback = await f.call({ operation: 'rollback', name: 'demo' });
    expect(rollback).toMatchObject({ tag: 'v1.0.0', commit: preview.commit, removed: ['NOTES.md'] });
    await f.call({ operation: 'rollback', name: 'demo', confirmed: true, expectedDigest: rollback.digest });
    expect(await f.hello()).toBe('v1');
    expect((await f.lock()).plugins.demo).toMatchObject({ tag: 'v1.0.0', previous: [] });
    await expect(f.call({ operation: 'rollback', name: 'demo' })).rejects.toThrow('Nothing to roll back');
});

test('update and rollback refuse local work; remove of unpushed work needs force', async () => {
    const f = await fixture();
    await f.confirm({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0' });
    const clone = join(f.user, 'demo');
    await writeFile(join(clone, 'src', 'demo', 'hello.ts'), 'export default async () => "edited";');
    await expect(f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0' })).rejects.toThrow(/local work.*src\/demo\/hello\.ts/);
    git(clone, 'commit', '-qam', 'local edit');
    await expect(f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0' })).rejects.toThrow(/Unpushed: [0-9a-f]+ local edit/);

    const remove = await f.call({ operation: 'remove', name: 'demo' });
    expect(remove).toMatchObject({ needsForce: true, dirty: [], removed: ['package.json', 'src/demo/hello.ts'] });
    expect(remove.unpushed?.[0]).toContain('local edit');
    await expect(f.call({ operation: 'remove', name: 'demo', confirmed: true, expectedDigest: remove.digest })).rejects.toThrow('force');
    expect(await readdir(f.user)).toEqual(['demo']);
    const gone = await f.call({ operation: 'remove', name: 'demo', force: true, confirmed: true, expectedDigest: remove.digest });
    expect(gone.status).toBe('applied');
    expect(await readdir(f.user)).toEqual([]);
    expect((await f.lock()).plugins).toEqual({});
});

test('requires: companions clone in the same step; dependents block remove; namespace collisions refuse', async () => {
    const f = await fixture();
    await expect(f.call({ operation: 'install', name: 'needy', repo: f.needy, tag: 'v1.0.0' })).rejects.toThrow('requires demo');
    const preview = await f.call({ operation: 'install', name: 'needy', repo: f.needy, tag: 'v1.0.0', with: { demo: { repo: f.demo, tag: 'v2.0.0' } } });
    expect(preview.companions).toMatchObject([{ name: 'demo', tag: 'v2.0.0', version: '2.0.0', namespaces: ['demo'] }]);
    await f.call({ operation: 'install', name: 'needy', repo: f.needy, tag: 'v1.0.0', with: { demo: { repo: f.demo, tag: 'v2.0.0' } }, confirmed: true, expectedDigest: preview.digest });
    expect((await readdir(f.user)).sort()).toEqual(['demo', 'needy']);
    expect(await f.hello('demo')).toBe('v2');
    expect(Object.keys((await f.lock()).plugins).sort()).toEqual(['demo', 'needy']);
    await expect(f.call({ operation: 'remove', name: 'demo' })).rejects.toThrow('required by needy');

    f.ctx.state.procs.modules.push({ name: 'other', dir: '/elsewhere/src', namespaces: ['clash'] });
    const bare = join(f.root, 'remotes', 'clash.git');
    const work = join(f.root, 'work', 'clash');
    await mkdir(bare, { recursive: true }); git(bare, 'init', '-q', '--bare');
    await mkdir(join(work, 'src', 'clash'), { recursive: true }); git(work, 'init', '-q', '-b', 'main');
    await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'clash', version: '1.0.0', procs: {} }));
    await writeFile(join(work, 'src', 'clash', 'x.ts'), 'export default () => 1;');
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'c'); git(work, 'tag', 'v1.0.0'); git(work, 'push', '-q', '--tags', bare, 'main');
    await expect(f.call({ operation: 'install', name: 'clash', repo: 'git+file://' + bare, tag: 'v1.0.0' })).rejects.toThrow('Namespace collision: clash is provided by other');
});
