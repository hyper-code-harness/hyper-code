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
import route from './$route_$name_git_POST';

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
    for (const [k, f] of Object.entries({ gitInstall, inspectPackage, lockFile, cloneStatus, cloneDir, cloneBadge, clonePanel, edit }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const p = await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.1' });
    await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'demo', repo: 'git+file://' + bare, tag: 'v1.0.1', confirmed: true, expectedDigest: p.digest });
    const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => route(ctx, null, {
        req: new Request('http://h/plugins/demo/git', { method: 'POST', body: new URLSearchParams(fields).toString(), headers: { origin: 'http://h', 'content-type': 'application/x-www-form-urlencoded', ...headers } }),
        params: { name: 'demo' },
    });
    return { root, ctx, calls, post, clone: join(root, 'user', 'demo') };
}

test('badges: release, edited, branch +N, fork', () => {
    const base = { commit: 'c'.repeat(40), sinceTag: 0, dirty: [], unpushed: [], ahead: 0, behind: 0, fork: false };
    const b = (g: any) => cloneBadge({} as any, null, { git: { ...base, ...g } }).map(x => x.label);
    expect(b({ tag: 'v1.0.1', baseTag: 'v1.0.1' })).toEqual(['v1.0.1']);
    expect(b({ tag: 'v1.0.1', dirty: ['x'] })).toEqual(['v1.0.1', 'edited']);
    expect(b({ branch: 'main', baseTag: 'v1.0.1', sinceTag: 3, unpushed: ['a b'] })).toEqual(['main +3', 'edited']);
    expect(b({ branch: 'main', tag: 'v1.0.1', fork: true })).toEqual(['main', 'fork']);
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
