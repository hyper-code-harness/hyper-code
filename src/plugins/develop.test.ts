import { test, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import inspectPackage from './inspectPackage';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';
import cloneDir from './cloneDir';
import edit from './edit';
import release from './release';
import fork from './fork';
import syncUpstream from './syncUpstream';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) { await chmod(r, 0o755).catch(() => {}); await rm(r, { recursive: true, force: true }); } });

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@l', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@l' };
// release and syncUpstream commit; a CI runner may have no git identity.
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...ENV } });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/** A bare `demo` remote at v1.0.0 installed as a clone in USER_PLUGINS; ghFork is stubbed with a local bare repo. */
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugin-dev-')));
    roots.push(root);
    const bare = join(root, 'remotes', 'demo.git');
    const work = join(root, 'work');
    await mkdir(bare, { recursive: true }); git(bare, 'init', '-q', '--bare', '-b', 'main');
    await mkdir(join(work, 'src', 'demo'), { recursive: true }); git(work, 'init', '-q', '-b', 'main');
    await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module', procs: { src: 'src' } }, null, 2) + '\n');
    await writeFile(join(work, 'src', 'demo', 'hello.ts'), 'export default async () => "v1";');
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'one'); git(work, 'tag', 'v1.0.0');
    git(work, 'push', '-q', '--tags', bare, 'main');
    const user = join(root, 'hyper', 'user');
    let reloads = 0;
    const forks: string[] = [];
    const ctx: any = {
        env: { USER_PLUGINS: user, HOME: root },
        state: { procs: { modules: [] } },
        fns: {
            plugins: {
                ghFork: async (o: any) => {
                    forks.push(o.repo);
                    const fork = join(root, 'remotes', 'fork.git');
                    git(join(root, 'remotes'), 'clone', '-q', '--bare', bare, fork);
                    return { url: fork, fullName: 'me/demo' };
                },
            },
            procs: { modules: { reload: async () => { reloads++; } }, project: { projectRoot: () => join(import.meta.dir, '..', '..') } },
        },
    };
    for (const [k, f] of Object.entries({ gitInstall, inspectPackage, lockFile, cloneStatus, cloneDir, edit, release, fork, syncUpstream }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const p = await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.0' });
    await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.0', confirmed: true, expectedDigest: p.digest });
    const clone = join(user, 'demo');
    const lock = async () => JSON.parse(await readFile(join(root, 'hyper', 'plugins.lock.json'), 'utf8')).plugins.demo;
    return { root, bare, work, clone, ctx, forks, lock, reloads: () => reloads };
}

test('edit switches to main, release bumps, tags, pushes and moves the lock', async () => {
    const f = await fixture();
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow('plugins.edit');
    const e = await f.ctx.fns.plugins.edit({ name: 'demo' });
    expect(e).toMatchObject({ branch: 'main', created: false });
    expect(git(f.clone, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main');
    await writeFile(join(f.clone, 'src', 'demo', 'hello.ts'), 'export default async () => "v1.0.1";');
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow('uncommitted');
    git(f.clone, 'commit', '-qam', 'fix');
    const r = await f.ctx.fns.plugins.release({ name: 'demo' });
    expect(r).toMatchObject({ version: '1.0.1', tag: 'v1.0.1', branch: 'main', tests: { ran: false } });
    expect(git(f.bare, 'rev-parse', 'refs/tags/v1.0.1^{commit}')).toBe(r.commit);
    expect(git(f.bare, 'rev-parse', 'refs/heads/main')).toBe(r.commit);
    expect(JSON.parse(git(f.bare, 'show', 'v1.0.1:package.json')).version).toBe('1.0.1');
    expect(await f.lock()).toMatchObject({ tag: 'v1.0.1', commit: r.commit, previous: [{ tag: 'v1.0.0' }] });
    await expect(f.ctx.fns.plugins.release({ name: 'demo', version: '1.0.1' })).rejects.toThrow('already exists');
    // A new branch starts at HEAD.
    expect(await f.ctx.fns.plugins.edit({ name: 'demo', branch: 'feature/x' })).toMatchObject({ branch: 'feature/x', created: true, commit: r.commit });
});

test('release from a branch-mode clone tags it and moves the lock back to that tag', async () => {
    const f = await fixture();
    await f.ctx.fns.plugins.gitInstall({ operation: 'update', name: 'demo', branch: 'main' })
        .then((p: any) => f.ctx.fns.plugins.gitInstall({ operation: 'update', name: 'demo', branch: 'main', confirmed: true, expectedDigest: p.digest }));
    expect(await f.lock()).toMatchObject({ branch: 'main', previous: [{ tag: 'v1.0.0' }] });
    expect(git(f.clone, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    await writeFile(join(f.clone, 'src', 'demo', 'hello.ts'), 'export default async () => "dev";');
    git(f.clone, 'commit', '-qam', 'dev fix');
    const r = await f.ctx.fns.plugins.release({ name: 'demo' });
    expect(r).toMatchObject({ tag: 'v1.0.1', branch: 'main' });
    const lock = await f.lock();
    expect(lock).toMatchObject({ tag: 'v1.0.1', commit: r.commit, previous: [{ tag: 'v1.0.0' }, { branch: 'main' }] });
    expect(lock.branch).toBeUndefined();
});

test('release without push rights suggests fork; fork rewires remotes; syncUpstream reports, merges and lists conflicts', async () => {
    const f = await fixture();
    await f.ctx.fns.plugins.edit({ name: 'demo' });
    // origin "on GitHub" that cannot be pushed to (unreachable here): release refuses before touching anything.
    git(f.clone, 'remote', 'set-url', 'origin', 'https://github.com/someone/demo.git');
    git(f.clone, 'config', 'url.' + join(f.root, 'nowhere') + '.insteadOf', 'https://github.com/someone/demo.git');
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow(/No push rights.*plugins\.fork/);
    expect(JSON.parse(await readFile(join(f.clone, 'package.json'), 'utf8')).version).toBe('1.0.0');

    const fk = await f.ctx.fns.plugins.fork({ name: 'demo' });
    expect(f.forks).toEqual(['someone/demo']);
    expect(fk.upstream).toBe('https://github.com/someone/demo.git');
    expect(git(f.clone, 'remote', 'get-url', 'origin')).toBe(join(f.root, 'remotes', 'fork.git'));
    await expect(f.ctx.fns.plugins.fork({ name: 'demo' })).rejects.toThrow('already has an upstream');
    // Point upstream at the original bare repo (no network in tests).
    git(f.clone, 'config', '--unset', 'url.' + join(f.root, 'nowhere') + '.insteadOf');
    git(f.clone, 'remote', 'set-url', 'upstream', f.bare);

    // Upstream moves on by one commit.
    await writeFile(join(f.work, 'UP.md'), 'upstream');
    git(f.work, 'add', '-A'); git(f.work, 'commit', '-qm', 'up'); git(f.work, 'push', '-q', f.bare, 'main');
    let s = await f.ctx.fns.plugins.syncUpstream({ name: 'demo' });
    expect(s).toMatchObject({ ref: 'upstream/main', behind: 1, ahead: 0, merged: false });
    s = await f.ctx.fns.plugins.syncUpstream({ name: 'demo', merge: true });
    expect(s).toMatchObject({ behind: 0, merged: true });
    expect(await readFile(join(f.clone, 'UP.md'), 'utf8')).toBe('upstream');

    // Conflicting edits on both sides: merge is aborted, files listed, clone unchanged.
    await writeFile(join(f.work, 'src', 'demo', 'hello.ts'), 'export default async () => "upstream";');
    git(f.work, 'commit', '-qam', 'up2'); git(f.work, 'push', '-q', f.bare, 'main');
    await writeFile(join(f.clone, 'src', 'demo', 'hello.ts'), 'export default async () => "mine";');
    git(f.clone, 'commit', '-qam', 'mine');
    const head = git(f.clone, 'rev-parse', 'HEAD');
    s = await f.ctx.fns.plugins.syncUpstream({ name: 'demo', merge: true });
    expect(s).toMatchObject({ behind: 1, ahead: 1, merged: false, conflicts: ['src/demo/hello.ts'], commit: head });
    expect(git(f.clone, 'status', '--porcelain')).toBe('');
});

test('release demands a committed bun.lock that matches package.json when the plugin has npm dependencies', async () => {
    const f = await fixture();
    await f.ctx.fns.plugins.edit({ name: 'demo' });
    const bun = (...args: string[]) => {
        const p = Bun.spawnSync([process.execPath, ...args], { cwd: f.clone, env: { ...process.env, BUN_BE_BUN: '1' } });
        if (p.exitCode) throw new Error(p.stderr.toString());
    };
    const pkg = async (deps: Record<string, string>) =>
        writeFile(join(f.clone, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module', procs: { src: 'src' }, dependencies: deps }, null, 2) + '\n');
    // An npm package vendored in the repository, so the test needs no network.
    await mkdir(join(f.clone, 'vendor', 'leaf'), { recursive: true });
    await writeFile(join(f.clone, 'vendor', 'leaf', 'package.json'), JSON.stringify({ name: 'leaf', version: '1.0.0', main: 'index.js' }));
    await writeFile(join(f.clone, 'vendor', 'leaf', 'index.js'), 'module.exports = 1;');
    await pkg({ leaf: 'file:./vendor/leaf' });
    git(f.clone, 'add', '-A'); git(f.clone, 'commit', '-qm', 'add leaf');
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow('bun.lock is not committed');

    // After `bun install` the new bun.lock is uncommitted work, like any other file of the author.
    bun('install');
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow('uncommitted changes — commit them first: bun.lock');
    git(f.clone, 'add', 'bun.lock'); git(f.clone, 'commit', '-qm', 'lock');

    await pkg({ leaf: 'file:./vendor/leaf', twig: 'file:./vendor/leaf' });
    git(f.clone, 'commit', '-qam', 'add twig, forget the lock');
    await expect(f.ctx.fns.plugins.release({ name: 'demo' })).rejects.toThrow('bun.lock of demo does not match package.json');
    expect(git(f.bare, 'tag', '--list')).toBe('v1.0.0');

    bun('install');
    git(f.clone, 'commit', '-qam', 'lock twig');
    const r = await f.ctx.fns.plugins.release({ name: 'demo' });
    expect(r.tag).toBe('v1.0.1');
    expect(git(f.bare, 'ls-tree', '--name-only', 'v1.0.1')).toContain('bun.lock');
    // What was released installs: the same clone moves to the tag with its dependencies from that bun.lock.
    expect(await f.lock()).toMatchObject({ tag: 'v1.0.1' });
}, 120_000);
