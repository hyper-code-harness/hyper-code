import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import inspectPackage from './inspectPackage';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';
import installed from './installed';
import readMetadata from './readMetadata';
import validateTree from './validateTree';

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
    for (const [k, f] of Object.entries({ inspectPackage, lockFile, cloneStatus, installed, readMetadata, validateTree })) ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
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

test('installed reports each clone: lock tag, commit, branch, dirty, ahead and fork', async () => {
    const f = await fixture();
    await f.confirm({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0' });
    const clone = join(f.user, 'demo');
    const at = async () => (await f.ctx.fns.plugins.installed({})).plugins.find((p: any) => p.name === 'demo');
    let p = await at();
    expect(p).toMatchObject({ status: 'clone', git: { lockedTag: 'v1.0.0', tag: 'v1.0.0', baseTag: 'v1.0.0', dirty: [], unpushed: [], ahead: 0, fork: false } });
    expect(p.git.branch).toBeUndefined();
    git(clone, 'switch', '-q', '-c', 'work');
    await writeFile(join(clone, 'x.md'), 'x');
    p = await at();
    expect(p).toMatchObject({ status: 'edited', git: { branch: 'work', dirty: ['x.md'] } });
    git(clone, 'add', '-A'); git(clone, 'commit', '-qm', 'x');
    git(clone, 'remote', 'set-url', 'origin', join(f.root, 'remotes', 'needy.git'));
    p = await at();
    expect(p.git).toMatchObject({ fork: true, unpushed: [expect.stringContaining(' x')] });
});

/** Commits a new hello.ts body on main of the demo work copy and pushes it: the branch moves upstream. */
async function moveMain(f: Awaited<ReturnType<typeof fixture>>, body: string, extra: Record<string, string> = {}) {
    const work = join(f.root, 'work', 'demo');
    await writeFile(join(work, 'src', 'demo', 'hello.ts'), `export default async () => ${JSON.stringify(body)};`);
    for (const [p, c] of Object.entries(extra)) await writeFile(join(work, p), c);
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main: ' + body);
    git(work, 'push', '-q', f.demo.slice('git+file://'.length), 'main');
    return git(work, 'rev-parse', 'HEAD');
}

test('branch mode: install on main tracks origin; the moved branch previews its commits and fast-forwards on confirm', async () => {
    const f = await fixture();
    const preview = await f.call({ operation: 'install', name: 'demo', repo: f.demo, branch: 'main' });
    expect(preview).toMatchObject({ status: 'preview', branch: 'main', plugin: { version: '2.0.0' } });
    expect(preview.tag).toBeUndefined();
    await f.call({ operation: 'install', name: 'demo', repo: f.demo, branch: 'main', confirmed: true, expectedDigest: preview.digest });
    const clone = join(f.user, 'demo');
    expect(git(clone, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(git(clone, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main');
    expect((await f.lock()).plugins.demo).toEqual({ repo: f.demo, branch: 'main', commit: preview.commit, previous: [] });

    const head = await moveMain(f, 'v3-dev');
    const update = await f.call({ operation: 'update', name: 'demo' });
    expect(update).toMatchObject({ branch: 'main', commit: head, from: { branch: 'main', commit: preview.commit }, changed: ['src/demo/hello.ts'] });
    expect(update.commits).toHaveLength(1);
    expect(update.commits![0]).toContain('main: v3-dev');
    expect(update.diffStat ?? '').toContain('hello.ts');
    expect(await f.hello()).toBe('v2'); // preview changes nothing
    await f.call({ operation: 'update', name: 'demo', confirmed: true, expectedDigest: update.digest });
    expect(await f.hello()).toBe('v3-dev');
    expect(git(clone, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect((await f.lock()).plugins.demo).toMatchObject({ branch: 'main', commit: head, previous: [{ branch: 'main', commit: preview.commit }] });
    expect((await cloneStatus({} as any, null, { dir: clone }))).toMatchObject({ branch: 'main', dirty: [], unpushed: [], behind: 0 });

    // A rewritten branch is not a fast-forward: refused, the clone stays.
    const work = join(f.root, 'work', 'demo');
    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    await writeFile(join(work, 'OTHER.md'), 'x'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'rewritten');
    git(work, 'push', '-q', '--force', f.demo.slice('git+file://'.length), 'main');
    await expect(f.call({ operation: 'update', name: 'demo' })).rejects.toThrow('not a fast-forward');
    expect(await f.hello()).toBe('v3-dev');
});

test('branch mode refuses local work like a tag clone', async () => {
    const f = await fixture();
    await f.confirm({ operation: 'install', name: 'demo', repo: f.demo, branch: 'main' });
    const clone = join(f.user, 'demo');
    await moveMain(f, 'v3-dev');
    await writeFile(join(clone, 'NOTES.md'), 'mine');
    await expect(f.call({ operation: 'update', name: 'demo' })).rejects.toThrow(/local work.*NOTES\.md/);
    git(clone, 'commit', '-qam', 'local note');
    await expect(f.call({ operation: 'update', name: 'demo' })).rejects.toThrow(/Unpushed: [0-9a-f]+ local note/);
});

test('commit mode: short SHA pins detached; nothing to update; switch to a tag and roll back across kinds', async () => {
    const f = await fixture();
    const work = join(f.root, 'work', 'demo');
    const v1 = git(work, 'rev-parse', 'v1.0.0^{commit}');
    await expect(f.call({ operation: 'install', name: 'demo', repo: f.demo, commit: 'deadbeef' })).rejects.toThrow('not reachable');
    await expect(f.call({ operation: 'install', name: 'demo', repo: f.demo, tag: 'v1.0.0', branch: 'main' })).rejects.toThrow('one of');
    const pin = await f.call({ operation: 'install', name: 'demo', repo: f.demo, commit: v1.slice(0, 7) });
    expect(pin).toMatchObject({ commit: v1 });
    expect(pin.tag).toBeUndefined(); expect(pin.branch).toBeUndefined();
    await f.call({ operation: 'install', name: 'demo', repo: f.demo, commit: v1.slice(0, 7), confirmed: true, expectedDigest: pin.digest });
    const clone = join(f.user, 'demo');
    expect(Bun.spawnSync(['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: clone }).exitCode).not.toBe(0);
    expect((await f.lock()).plugins.demo).toEqual({ repo: f.demo, commit: v1, previous: [] });
    await expect(f.call({ operation: 'update', name: 'demo' })).rejects.toThrow('nothing to update');

    // commit → tag
    const toTag = await f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0' });
    expect(toTag.from).toEqual({ commit: v1, tag: 'v1.0.0' });
    await f.call({ operation: 'update', name: 'demo', tag: 'v2.0.0', confirmed: true, expectedDigest: toTag.digest });
    expect(await f.hello()).toBe('v2');
    // tag → branch
    const head = await moveMain(f, 'v3-dev');
    await f.confirm({ operation: 'update', name: 'demo', branch: 'main' });
    expect(await f.hello()).toBe('v3-dev');
    expect(git(clone, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect((await f.lock()).plugins.demo).toMatchObject({ branch: 'main', commit: head, previous: [{ commit: v1 }, { tag: 'v2.0.0' }] });

    // rollback: branch → tag (detached) → commit
    const back = await f.call({ operation: 'rollback', name: 'demo' });
    expect(back).toMatchObject({ tag: 'v2.0.0', from: { branch: 'main', commit: head } });
    await f.call({ operation: 'rollback', name: 'demo', confirmed: true, expectedDigest: back.digest });
    expect(await f.hello()).toBe('v2');
    expect(Bun.spawnSync(['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: clone }).exitCode).not.toBe(0);
    await f.confirm({ operation: 'rollback', name: 'demo' });
    expect(await f.hello()).toBe('v1');
    expect((await f.lock()).plugins.demo).toEqual({ repo: f.demo, commit: v1, previous: [] });
});

test('lock files from before ref modes read unchanged; a malformed previous entry is refused', async () => {
    const f = await fixture();
    const file = join(f.root, 'hyper', 'plugins.lock.json');
    await mkdir(join(f.root, 'hyper'), { recursive: true });
    const old = { plugins: { demo: { repo: f.demo, tag: 'v1.0.0', commit: 'a'.repeat(40), previous: [{ tag: 'v0.9.0', commit: 'b'.repeat(40) }] } } };
    await writeFile(file, JSON.stringify(old));
    expect((await f.ctx.fns.plugins.lockFile({})).lock).toEqual(old);
    await writeFile(file, JSON.stringify({ plugins: { demo: { ...old.plugins.demo, previous: [{ tag: 'v0.9.0' }] } } }));
    await expect(f.ctx.fns.plugins.lockFile({})).rejects.toThrow('Malformed');
});
