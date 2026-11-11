import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInit from './gitInit';
import inspectPackage from './inspectPackage';
import cloneStatus from './cloneStatus';
import cloneBadge from './cloneBadge';
import installed from './installed';
import lockFile from './lockFile';
import readMetadata from './readMetadata';
import validateTree from './validateTree';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/** USER_PLUGINS with one plain folder `notes` (a private plugin with an installed npm package), no git anywhere. */
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-init-')));
    roots.push(root);
    const user = join(root, 'hyper', 'user');
    const dir = join(user, 'notes');
    await mkdir(join(dir, 'src', 'notes'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'leaf'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'notes', procs: { src: 'src', label: 'Notes', description: 'Private notes.' } }));
    await writeFile(join(dir, 'src', 'notes', 'list.ts'), 'export default async () => [];');
    await writeFile(join(dir, 'node_modules', 'leaf', 'index.js'), 'module.exports = 1;');
    const ctx: any = { env: { USER_PLUGINS: user, HOME: root }, state: { procs: { modules: [] } }, fns: { plugins: {} } };
    for (const [k, f] of Object.entries({ gitInit, inspectPackage, cloneStatus, cloneBadge, installed, lockFile, readMetadata, validateTree }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const status = async () => (await ctx.fns.plugins.installed({})).plugins.find((p: any) => p.name === 'notes');
    return { root, user, dir, ctx, status };
}

test('a plain plugin folder becomes a local git repository: one commit, node_modules left out, shown as local', async () => {
    const f = await fixture();
    expect((await f.status()).status).toBe('unmanaged');
    const before = await readFile(join(f.dir, 'package.json'), 'utf8');

    const r = await f.ctx.fns.plugins.gitInit({ name: 'notes' });
    expect(r).toMatchObject({ name: 'notes', dir: f.dir, branch: 'main', files: ['package.json', 'src/notes/list.ts'] });
    expect(git(f.dir, 'rev-parse', 'HEAD')).toBe(r.commit);
    expect(git(f.dir, 'log', '--format=%s')).toBe('notes: local plugin under git');
    expect(git(f.dir, 'remote')).toBe('');
    expect(git(f.dir, 'status', '--porcelain')).toBe('');
    // The plugin's own files are untouched and what bun installed is still there, outside git.
    expect(await readFile(join(f.dir, 'package.json'), 'utf8')).toBe(before);
    expect(await readdir(join(f.dir, 'node_modules'))).toEqual(['leaf']);

    // A clean local repository is not "edited": its commits have no remote to be pushed to.
    let s = await f.status();
    expect(s.status).toBe('local');
    expect(s.git).toMatchObject({ local: true, branch: 'main', fork: false });
    expect(s.git.unpushed.length).toBe(1);
    expect(f.ctx.fns.plugins.cloneBadge({ git: s.git })).toEqual([{ label: 'local', kind: 'local' }]);

    await writeFile(join(f.dir, 'src', 'notes', 'list.ts'), 'export default async () => [1];');
    s = await f.status();
    expect(s.status).toBe('edited');
    expect(f.ctx.fns.plugins.cloneBadge({ git: s.git }).map((b: any) => b.label)).toEqual(['local', 'edited']);

    await expect(f.ctx.fns.plugins.gitInit({ name: 'notes' })).rejects.toThrow('notes is already a git repository');
});

test('refusals leave the folder as it was: not installed, a bad name, a tree the package check rejects', async () => {
    const f = await fixture();
    await expect(f.ctx.fns.plugins.gitInit({ name: 'absent' })).rejects.toThrow('Plugin is not installed: absent');
    await expect(f.ctx.fns.plugins.gitInit({ name: '../notes' })).rejects.toThrow('Invalid plugin name');

    await symlink('/etc/hosts', join(f.dir, 'src', 'notes', 'hosts'));
    await expect(f.ctx.fns.plugins.gitInit({ name: 'notes' })).rejects.toThrow('Only regular files and directories allowed');
    expect(await readdir(f.dir)).not.toContain('.git');
    expect((await f.status()).status).toBe('unmanaged');

    // A folder whose package.json names another plugin is not committed under this name.
    await rm(join(f.dir, 'src', 'notes', 'hosts'));
    await writeFile(join(f.dir, 'package.json'), JSON.stringify({ name: 'other', procs: { src: 'src' } }));
    await expect(f.ctx.fns.plugins.gitInit({ name: 'notes' })).rejects.toThrow('Package is other, not notes');
    expect(await readdir(f.dir)).not.toContain('.git');
});

test('a commit that fails (here: a pre-commit hook says no) removes the half-made repository', async () => {
    const f = await fixture();
    const hooks = join(f.root, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks };
    const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
        await expect(f.ctx.fns.plugins.gitInit({ name: 'notes' })).rejects.toThrow('git commit failed');
    } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    expect(await readdir(f.dir)).not.toContain('.git');
    expect((await f.status()).status).toBe('unmanaged');
    // Once the obstacle is gone the same call works.
    expect((await f.ctx.fns.plugins.gitInit({ name: 'notes' })).branch).toBe('main');
});

/** Runs fn as on a machine where git knows no user: no global or system config, no identity in the environment. */
async function withoutIdentity<T>(root: string, fn: () => Promise<T>): Promise<T> {
    const env: Record<string, string | undefined> = {
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: root, XDG_CONFIG_HOME: join(root, 'xdg'),
        GIT_AUTHOR_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_NAME: undefined, GIT_COMMITTER_EMAIL: undefined, EMAIL: undefined,
    };
    const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

test('a machine without a git identity: the commit is authored by Hyper, and a failure still names the git command', async () => {
    const f = await fixture();
    const hooks = join(f.root, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);
    await withoutIdentity(f.root, async () => {
        Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks });
        try {
            await expect(f.ctx.fns.plugins.gitInit({ name: 'notes' })).rejects.toThrow('git commit failed: hook says no');
        } finally { for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[k]; }
        expect(await readdir(f.dir)).not.toContain('.git');
        await f.ctx.fns.plugins.gitInit({ name: 'notes' });
    });
    expect(git(f.dir, 'log', '--format=%an <%ae> / %cn <%ce>')).toBe('Hyper <hyper@localhost> / Hyper <hyper@localhost>');
});
