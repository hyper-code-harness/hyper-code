import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import inspectPackage from './inspectPackage';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';
import migrateToGit from './migrateToGit';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

test('migrateToGit clones each host dependency at its tag, drops it from the host in the same step and verifies the mount', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'migrate-git-')));
    roots.push(root);
    const bare = join(root, 'chart.git'), work = join(root, 'work');
    await mkdir(bare); git(bare, 'init', '-q', '--bare');
    await mkdir(join(work, 'src', 'chartNs'), { recursive: true }); git(work, 'init', '-q', '-b', 'main');
    await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'chart', version: '1.0.0', procs: {} }));
    await writeFile(join(work, 'src', 'chartNs', 'draw.ts'), 'export default () => 1;');
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'one'); git(work, 'tag', 'v1.0.0'); git(work, 'push', '-q', '--tags', bare, 'main');

    // The old bun host: chart at v1.0.0 (a copy of the tree in node_modules), plus a dependency that is not a release.
    const host = join(root, 'plugins');
    await mkdir(join(host, 'node_modules'), { recursive: true });
    await cp(join(work, 'src'), join(host, 'node_modules', 'chart', 'src'), { recursive: true });
    await cp(join(work, 'package.json'), join(host, 'node_modules', 'chart', 'package.json'));
    await writeFile(join(host, 'package.json'), JSON.stringify({ name: 'hyper-plugins', private: true, dependencies: { chart: `git+file://${bare}#v1.0.0`, odd: 'github:x/odd#main' } }));
    await writeFile(join(host, 'bun.lock'), 'lock');
    const user = join(root, 'user');
    let reloads = 0;
    const watcher: string[] = [];
    const ctx: any = {
        env: { USER_PLUGINS: user, PLUGIN_HOST: host, HOME: root },
        // Mounted from the host now: the clone replacing it is not a namespace collision.
        state: { procs: { modules: [{ name: 'chart', dir: join(host, 'node_modules', 'chart', 'src'), namespaces: ['chartNs'] }] } },
        fns: {
            plugins: { watchClones: async (o: any) => { watcher.push(o.stop ? 'stop' : 'start'); return {}; } },
            procs: { modules: { reload: async () => {
                reloads++;
                const deps = JSON.parse(await readFile(join(host, 'package.json'), 'utf8')).dependencies;
                ctx.state.procs.modules = deps.chart ? [{ name: 'chart', dir: join(host, 'node_modules', 'chart', 'src'), namespaces: ['chartNs'] }]
                    : [{ name: 'chart', dir: join(user, 'chart', 'src'), namespaces: ['chartNs'] }];
            } } },
        },
    };
    for (const [k, f] of Object.entries({ gitInstall, inspectPackage, lockFile, cloneStatus, migrateToGit })) ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);

    const preview = await ctx.fns.plugins.migrateToGit({});
    expect(preview.plugins.map((p: any) => [p.name, p.status])).toEqual([['odd', 'skipped'], ['chart', 'preview']]);
    expect(preview.plugins[1].namespaces).toEqual(['chartNs']);
    expect(await readdir(user).catch(() => [])).toEqual([]);

    const done = await ctx.fns.plugins.migrateToGit({ confirmed: true });
    expect(done.plugins.find((p: any) => p.name === 'chart')).toMatchObject({ status: 'migrated', tag: 'v1.0.0' });
    expect(done.verified).toBe(true);
    expect(done.remaining).toEqual({ odd: 'github:x/odd#main' });
    expect(reloads).toBe(1);
    expect(watcher).toEqual(['stop', 'start']);
    expect(git(join(user, 'chart'), 'describe', '--tags')).toBe('v1.0.0');
    expect(JSON.parse(await readFile(join(done.backup, 'package.json'), 'utf8')).dependencies.chart).toContain('#v1.0.0');
    expect(await readFile(join(done.backup, 'bun.lock'), 'utf8')).toBe('lock');
    expect(JSON.parse(await readFile(join(root, 'plugins.lock.json'), 'utf8')).plugins.chart.tag).toBe('v1.0.0');
    // Running it again finds nothing left to move.
    expect((await ctx.fns.plugins.migrateToGit({})).plugins.map((p: any) => p.status)).toEqual(['skipped']);
});
