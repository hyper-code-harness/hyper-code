import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import inspectPackage from './inspectPackage';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';
import cloneDir from './cloneDir';
import cloneBadge from './cloneBadge';
import clonePanel from './clonePanel';
import edit from './edit';
import branchUpdates from './branchUpdates';
import route from './$route_$name_git_POST';
import repoUrl from './repoUrl';
import remotePackage from './remotePackage';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@l', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@l' };

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...ENV } });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'clone-panel-')));
    roots.push(root);
    const bare = join(root, 'demo.git'), work = join(root, 'work');
    await mkdir(bare); git(bare, 'init', '-q', '--bare', '-b', 'main');
    await mkdir(join(work, 'src', 'demo'), { recursive: true }); git(work, 'init', '-q', '-b', 'main');
    await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.1', procs: {} }));
    await writeFile(join(work, 'src', 'demo', 'a.ts'), 'export default () => 1;');
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'one'); git(work, 'tag', 'v1.0.1'); git(work, 'push', '-q', '--tags', bare, 'main');
    const calls: string[] = [];
    const ctx: any = {
        env: { USER_PLUGINS: join(root, 'user'), HOME: root },
        state: { procs: { modules: [] } },
        fns: {
            auth: {
                csrfField: async () => '<input type="hidden" name="_csrf" value="tok">',
                verifyCsrf: async ({ token }: any) => token === 'tok',
            },
            procs: { modules: { reload: async () => {} } },
            plugins: {
                release: async () => { calls.push('release'); return { tag: 'v1.0.2', commit: 'a'.repeat(40), pushed: 'origin' }; },
                fork: async () => { calls.push('fork'); return { origin: 'o', upstream: 'u' }; },
                syncUpstream: async () => ({ ref: 'upstream/main', behind: 0, ahead: 0, merged: false }),
            },
        },
    };
    for (const [k, f] of Object.entries({ gitInstall, inspectPackage, lockFile, cloneStatus, cloneDir, cloneBadge, clonePanel, edit, branchUpdates, repoUrl, remotePackage }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const p = await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.1' });
    await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.1', confirmed: true, expectedDigest: p.digest });
    const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => route(ctx, null, {
        req: new Request('http://h/plugins/demo/git', { method: 'POST', body: new URLSearchParams(fields).toString(), headers: { origin: 'http://h', 'content-type': 'application/x-www-form-urlencoded', ...headers } }),
        params: { name: 'demo' },
    });
    return { root, ctx, calls, post, bare, work, clone: join(root, 'user', 'demo') };
}

test('badges: release, edited, branch +N, fork', () => {
    const base = { commit: 'c'.repeat(40), sinceTag: 0, dirty: [], unpushed: [], ahead: 0, behind: 0, fork: false };
    const b = (g: any) => cloneBadge({} as any, null, { git: { ...base, ...g } }).map(x => x.label);
    expect(b({ tag: 'v1.0.1', baseTag: 'v1.0.1' })).toEqual(['v1.0.1']);
    expect(b({ tag: 'v1.0.1', dirty: ['x'] })).toEqual(['v1.0.1', 'edited']);
    expect(b({ branch: 'main', baseTag: 'v1.0.1', sinceTag: 3, unpushed: ['a b'] })).toEqual(['main +3', 'edited']);
    expect(b({ branch: 'main', tag: 'v1.0.1', fork: true })).toEqual(['main', 'fork']);
    expect(b({ mode: 'branch', lockedBranch: 'main', branch: 'main', tag: 'v1.0.1' })).toEqual(['main · ccccccc']);
    expect(b({ mode: 'branch', lockedBranch: 'main', branch: 'main', newCommits: 2 })).toEqual(['main · ccccccc', '+2 new']);
    expect(b({ mode: 'commit', baseTag: 'v1.0.1', sinceTag: 4 })).toEqual(['ccccccc']);
    // A branch clone switched to another branch by plugins.edit shows the edit state, not the mode.
    expect(b({ mode: 'branch', lockedBranch: 'main', branch: 'fix', sinceTag: 1 })).toEqual(['fix +1']);
});

test('panel on a clean install offers Edit, Update and no Release; after edit it offers Release', async () => {
    const f = await fixture();
    const req = new Request('http://h/plugins/demo');
    let html = await f.ctx.fns.plugins.clonePanel({ name: 'demo', req });
    expect(html).toContain('data-badge="release">v1.0.1');
    expect(html).toContain('data-git-action="edit"');
    expect(html).toContain('data-git-action="install"');
    expect(html).not.toContain('data-git-action="release"');
    expect(html).not.toContain('data-git-action="rollback"');
    expect(html).toContain('name="_csrf"');
    expect(await f.ctx.fns.plugins.clonePanel({ name: 'nope', req })).toBe('');

    const r = await f.post({ _csrf: 'tok', operation: 'edit' });
    html = (r as any).main;
    expect(html).toContain('On branch main');
    expect(html).toContain('data-git-action="release"');
    expect(html).toContain('data-badge="ahead">main');
});

test('route: CSRF, origin and fields are checked; release and fork confirm first', async () => {
    const f = await fixture();
    expect(((await f.post({ _csrf: 'bad', operation: 'edit' })) as Response).status).toBe(403);
    expect(((await f.post({ _csrf: 'tok', operation: 'edit' }, { origin: 'http://evil' })) as Response).status).toBe(403);
    expect(((await f.post({ _csrf: 'tok', operation: 'rm' })) as Response).status).toBe(400);
    expect(((await f.post({ _csrf: 'tok', operation: 'edit', extra: '1' })) as Response).status).toBe(400);

    let r: any = await f.post({ _csrf: 'tok', operation: 'release' });
    expect(r.main).toContain('Confirm release');
    expect(f.calls).toEqual([]);
    r = await f.post({ _csrf: 'tok', operation: 'release', confirmed: 'true' });
    expect(r.main).toContain('Released v1.0.2');
    r = await f.post({ _csrf: 'tok', operation: 'fork' });
    expect(r.main).toContain('Confirm fork');
    await f.post({ _csrf: 'tok', operation: 'fork', confirmed: 'true' });
    expect(f.calls).toEqual(['release', 'fork']);
    r = await f.post({ _csrf: 'tok', operation: 'sync' });
    expect(r.main).toContain('Up to date with upstream/main');
});

test('branch mode on the page: "+N new" and Update (+N new); Switch to previews through plugins.install', async () => {
    const f = await fixture();
    // Re-install the clone on main (branch mode).
    const gone = await f.ctx.fns.plugins.gitInstall({ operation: 'remove', name: 'demo' });
    await f.ctx.fns.plugins.gitInstall({ operation: 'remove', name: 'demo', confirmed: true, expectedDigest: gone.digest });
    const p = await f.ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + f.bare, branch: 'main' });
    await f.ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + f.bare, branch: 'main', confirmed: true, expectedDigest: p.digest });
    const req = new Request('http://h/plugins/demo');
    let html = await f.ctx.fns.plugins.clonePanel({ name: 'demo', req });
    expect(html).toContain(`data-badge="branch">main · ${p.commit!.slice(0, 7)}`);
    expect(html).toContain('follows branch <code>main</code>');
    expect(html).toContain('data-git-switch');
    expect(html).toContain('<option value="branch" selected>');

    await writeFile(join(f.work, 'src', 'demo', 'a.ts'), 'export default () => 2;');
    git(f.work, 'add', '-A'); git(f.work, 'commit', '-qm', 'two'); git(f.work, 'push', '-q', f.bare, 'main');
    f.ctx.state.pluginBranchHeads?.clear();
    html = await f.ctx.fns.plugins.clonePanel({ name: 'demo', req });
    expect(html).toContain('data-badge="new">+1 new');
    expect(html).toContain('Update (+1 new)');
    expect(html).toMatch(/1 new commit on <code>origin\/main<\/code>:<br><code>[0-9a-f]+ two<\/code>/);
    // The checkout did not move: only origin/main was fetched.
    expect(git(f.clone, 'rev-parse', 'HEAD')).toBe(p.commit!);

    const seen: any[] = [];
    f.ctx.fns.plugins.install = async (o: any) => { seen.push(o); return { operation: 'update', name: 'demo', tag: 'v1.0.1', commit: 'c'.repeat(40), added: [], removed: [], changed: [], newPackages: [], digest: 'd', status: 'preview' }; };
    f.ctx.fns.plugins.listingPage = async (o: any) => `review ${o.change.tag}`;
    expect(((await f.post({ _csrf: 'tok', operation: 'switch', kind: 'nope', ref: 'x' })) as Response).status).toBe(400);
    expect(((await f.post({ _csrf: 'bad', operation: 'switch', kind: 'tag', ref: 'v1.0.1' })) as Response).status).toBe(403);
    const r: any = await f.post({ _csrf: 'tok', operation: 'switch', kind: 'tag', ref: 'v1.0.1' });
    expect(r.main).toBe('review v1.0.1');
    await f.post({ _csrf: 'tok', operation: 'switch', kind: 'commit', ref: 'ABC1234' });
    expect(seen).toEqual([{ name: 'demo', version: '1.0.1' }, { name: 'demo', commit: 'abc1234' }]);
    f.ctx.fns.plugins.install = async () => { throw new Error('No branch nope on origin'); };
    expect(((await f.post({ _csrf: 'tok', operation: 'switch', kind: 'branch', ref: 'nope' })) as any).main).toContain('No branch nope on origin');
});

test('a local plugin (git repository without a remote) shows the local badge, no Release, no Unpushed row', async () => {
    const f = await fixture();
    const dir = join(f.root, 'user', 'notes');
    await mkdir(join(dir, 'src', 'notes'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'notes', procs: {} }));
    await writeFile(join(dir, 'src', 'notes', 'a.ts'), 'export default () => 1;');
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'one');
    const html = await f.ctx.fns.plugins.clonePanel({ name: 'notes', req: new Request('http://x/plugins/notes') });
    expect(html).toContain('data-badge="local">local<');
    expect(html).toContain('a local plugin: versioned here, published nowhere');
    expect(html).toContain('plugins.publish({ name, repo })');
    expect(html).not.toContain('Unpushed');
    expect(html).not.toContain('value="release"');
    expect(html).not.toContain('data-git-switch');
});
