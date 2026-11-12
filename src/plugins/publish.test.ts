import { test, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import create from './create';
import publish from './publish';
import release from './release';
import releaseCheck from './releaseCheck';
import edit from './edit';
import gitInit from './gitInit';
import gitInstall from './gitInstall';
import install from './install';
import catalog from './catalog';
import listing from './listing';
import versions from './versions';
import branchUpdates from './branchUpdates';
import inspectPackage from './inspectPackage';
import cloneStatus from './cloneStatus';
import cloneDir from './cloneDir';
import cloneBadge from './cloneBadge';
import installed from './installed';
import readMetadata from './readMetadata';
import validateTree from './validateTree';
import lockFile from './lockFile';
import repoUrl from './repoUrl';
import remotePackage from './remotePackage';
import checkUpdates from './checkUpdates';
import pendingUpdates from './pendingUpdates';
import dockUpdates from './$dock_updates';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) { await chmod(join(r, 'server'), 0o755).catch(() => {}); await rm(r, { recursive: true, force: true }); } });

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@l', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@l' };
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...ENV } });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/**
 * Two machines and a git server, all local: `author` and `user` each have their own USER_PLUGINS and lock; the
 * server is a folder of bare repositories reached as https://git.example.test/<path> (git rewrites the address).
 * It holds an empty `team/notes.git` and a listing repository with one plugin in it.
 */
async function world() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugin-publish-')));
    roots.push(root);
    const server = join(root, 'server');
    const bare = async (rel: string) => { const d = join(server, rel); await mkdir(d, { recursive: true }); git(d, 'init', '-q', '--bare', '-b', 'main'); return d; };
    await bare('team/notes.git');
    const listingBare = await bare('team/listing.git');
    const seed = join(root, 'seed');
    await mkdir(join(seed, 'plugins'), { recursive: true }); git(seed, 'init', '-q', '-b', 'main');
    const other = { name: 'other', label: 'Other', description: 'Another plugin.', source: 'https://git.example.test/team/other' };
    await writeFile(join(seed, 'plugins', 'other.json'), JSON.stringify(other, null, 2) + '\n');
    await writeFile(join(seed, 'index.json'), JSON.stringify({ format: 2, plugins: [other] }, null, 2) + '\n');
    await writeFile(join(seed, 'README.md'), 'listing\n');
    git(seed, 'add', '-A'); git(seed, 'commit', '-qm', 'listing'); git(seed, 'push', '-q', listingBare, 'main');

    const machine = (who: string) => {
        const home = join(root, who);
        let reloads = 0;
        const ctx: any = {
            env: { USER_PLUGINS: join(home, 'hyper', 'user'), HOME: home },
            state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
            fns: {
                // The catalog of this machine reads the listing repository's index.json as the server holds it now.
                settings: { get: async () => ['file://' + join(home, 'index.json')] },
                procs: { modules: { reload: async () => { reloads++; } }, project: { projectRoot: () => join(import.meta.dir, '..', '..') } },
                plugins: { ghRepo: async () => { throw new Error('gh must not be called for a non-GitHub server'); } },
            },
        };
        for (const [k, f] of Object.entries({ create, publish, release, releaseCheck, edit, gitInit, gitInstall, install, catalog, listing, versions, branchUpdates, inspectPackage, cloneStatus, cloneDir, cloneBadge, installed, readMetadata, validateTree, lockFile, repoUrl, remotePackage, checkUpdates, pendingUpdates }))
            ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
        // "Pull" the listing: copy index.json from the listing repository on the server.
        const pullListing = async () => { await mkdir(home, { recursive: true }); await writeFile(join(home, 'index.json'), git(listingBare, 'show', 'main:index.json') + '\n'); (ctx.state as any).pluginVersions?.clear(); };
        const lock = async () => JSON.parse(await readFile(join(home, 'hyper', 'plugins.lock.json'), 'utf8').catch(() => '{"plugins":{}}')).plugins;
        return { ctx, home, user: ctx.env.USER_PLUGINS as string, pullListing, lock, reloads: () => reloads };
    };
    const author = machine('author'), user = machine('user');
    await author.pullListing(); await user.pullListing();
    return { root, server, listingBare, author, user };
}

/** Runs fn with https://git.example.test/ resolving to the local server folder. */
async function online<T>(server: string, fn: () => Promise<T>): Promise<T> {
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${server}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://git.example.test/' };
    const was = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const REPO = 'https://git.example.test/team/notes.git';
const LISTING = 'https://git.example.test/team/listing.git';

test('create: a starter plugin under local git, mounted; taken names and namespaces are refused and leave nothing behind', async () => {
    const w = await world();
    const a = w.author;
    const made = await a.ctx.fns.plugins.create({ name: 'team-notes', description: 'Keep short notes for the team.' });
    expect(made).toMatchObject({ name: 'team-notes', namespace: 'teamNotes', version: '0.1.0', functions: ['teamNotes.hello'], mounted: true });
    expect(made.files).toEqual(['.gitignore', 'SKILL.md', 'package.json', 'src/teamNotes/hello.test.ts', 'src/teamNotes/hello.ts']);
    expect(a.reloads()).toBe(1);
    const dir = join(a.user, 'team-notes');
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))).toEqual({ name: 'team-notes', version: '0.1.0', type: 'module', procs: { src: 'src', label: 'Team Notes', icon: 'ph-puzzle-piece', optional: true, description: 'Keep short notes for the team.' } });
    expect(git(dir, 'log', '--format=%s')).toBe('team-notes: local plugin under git');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(dir, 'remote')).toBe('');
    // The starter function works and its own test passes through the same check a release runs.
    const hello = (await import(join(dir, 'src', 'teamNotes', 'hello.ts'))).default;
    expect(await hello({}, null, { to: 'Ada' })).toEqual({ plugin: 'team-notes', message: 'Hello, Ada!' });
    const check = await a.ctx.fns.plugins.releaseCheck({ name: 'team-notes' });
    expect(check.tests.ran).toBe(true);
    expect(check.tests.output).toContain('1 pass');
    expect((await a.ctx.fns.plugins.installed({})).plugins.find((p: any) => p.name === 'team-notes').status).toBe('local');

    await expect(a.ctx.fns.plugins.create({ name: 'team-notes', description: 'Again, the same name.' })).rejects.toThrow('team-notes already exists in USER_PLUGINS');
    await expect(a.ctx.fns.plugins.create({ name: 'Bad_Name', description: 'Not a valid name here.' })).rejects.toThrow('Plugin name must be lowercase');
    await expect(a.ctx.fns.plugins.create({ name: 'x1', description: 'short' })).rejects.toThrow('description is required');
    await expect(a.ctx.fns.plugins.create({ name: 'helper', namespace: 'agent', description: 'Wants a core namespace.' })).rejects.toThrow('Namespace agent is already used by');
    await expect(a.ctx.fns.plugins.create({ name: 'other', description: 'A name the catalog already has.' })).rejects.toThrow('A plugin named other is already in the catalog');
    expect((await readdir(a.user)).sort()).toEqual(['team-notes']);
});

test('create that fails half-way (here: the first commit is refused by a hook) removes the folder it wrote', async () => {
    const w = await world();
    const a = w.author;
    const hooks = join(w.root, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks };
    const was = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
        await expect(a.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.' })).rejects.toThrow('git commit failed: hook says no');
    } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    // Nothing is left to be mounted by the next reload, and nothing was remounted.
    expect(await readdir(a.user)).toEqual([]);
    expect(a.reloads()).toBe(0);
    // The same call works once the obstacle is gone.
    expect((await a.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.' })).mounted).toBe(true);
});

test('the whole cycle on a server that is not GitHub: create → publish → install elsewhere → release → update → rollback', async () => {
    const w = await world();
    const a = w.author, u = w.user;
    await online(w.server, async () => {
        await a.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.', icon: 'ph-note' });
        const dir = join(a.user, 'notes');

        // ── first publication: preview changes nothing ────────────────────
        const preview = await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING });
        expect(preview).toMatchObject({
            status: 'preview', version: '1.0.0', tag: 'v1.0.0', repo: REPO, branch: 'main', remote: 'empty',
            packageChanges: ['version: 0.1.0 → 1.0.0', `repository: (none) → ${REPO}`],
            entry: { name: 'notes', label: 'Notes', icon: 'ph-note', description: 'Keep short notes for the team.', source: REPO },
            listing: { status: 'will-add', repo: LISTING },
        });
        expect(preview.creates).toBeUndefined();
        expect(preview.tests.ran).toBe(true);
        expect(git(dir, 'remote')).toBe('');
        expect(git(dir, 'tag', '--list')).toBe('');
        expect(git(join(w.server, 'team/notes.git'), 'for-each-ref')).toBe('');
        expect(git(w.listingBare, 'log', '--format=%s')).toBe('listing');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING, confirmed: true, expectedDigest: 'x' })).rejects.toThrow('Preview digest mismatch');
        // Another target or version is another publication: the reviewed digest does not carry over.
        expect((await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.1', listing: LISTING })).digest).not.toBe(preview.digest);

        const done = await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING, confirmed: true, expectedDigest: preview.digest });
        expect(done).toMatchObject({ status: 'published', at: 'tag', listing: { status: 'added', repo: LISTING } });
        const remote = join(w.server, 'team/notes.git');
        expect(git(remote, 'rev-parse', 'refs/tags/v1.0.0^{commit}')).toBe(done.commit);
        expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(done.commit);
        expect(JSON.parse(git(remote, 'show', 'v1.0.0:package.json'))).toMatchObject({ name: 'notes', version: '1.0.0', repository: { type: 'git', url: REPO } });
        expect(git(remote, 'ls-tree', '-r', '--name-only', 'v1.0.0').split('\n')).not.toContain('node_modules');
        // The author's clone is now an installed plugin at its tag, recorded in the lock.
        expect(await a.lock()).toEqual({ notes: { repo: REPO, tag: 'v1.0.0', commit: done.commit, previous: [] } });
        expect(git(dir, 'config', '--get', 'remote.origin.url')).toBe(REPO);
        expect(git(dir, 'describe', '--tags', '--exact-match')).toBe('v1.0.0');
        expect(Bun.spawnSync(['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: dir }).exitCode).not.toBe(0);
        const mine = (await a.ctx.fns.plugins.installed({})).plugins.find((p: any) => p.name === 'notes');
        expect([mine.status, a.ctx.fns.plugins.cloneBadge({ git: mine.git }).map((b: any) => b.label)]).toEqual(['clone', ['v1.0.0']]);
        // The listing repository got exactly one commit: the entry and the regenerated index.
        expect(git(w.listingBare, 'log', '--format=%s')).toBe('notes 1.0.0\nlisting');
        expect(git(w.listingBare, 'show', '--name-only', '--format=', 'main').split('\n').sort()).toEqual(['index.json', 'plugins/notes.json']);
        expect(JSON.parse(git(w.listingBare, 'show', 'main:index.json')).plugins.map((p: any) => p.name)).toEqual(['notes', 'other']);
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO })).rejects.toThrow('already has an origin');

        // ── another machine installs it from the catalog ──────────────────
        await u.pullListing();
        expect((await u.ctx.fns.plugins.catalog({ q: 'notes' })).plugins[0]).toMatchObject({ name: 'notes', source: REPO, latest: '1.0.0', update: false });
        const ip = await u.ctx.fns.plugins.install({ name: 'notes' });
        expect(ip).toMatchObject({ repo: REPO, tag: 'v1.0.0', commit: done.commit });
        await u.ctx.fns.plugins.install({ name: 'notes', confirmed: true, expectedDigest: ip.digest });
        const theirs = join(u.user, 'notes');
        // Nothing newer yet: the check says so, records it, and the Dock shows no badge.
        expect(await u.ctx.fns.plugins.pendingUpdates({})).toEqual({ checkedAt: null, updates: [], errors: [] });
        const quiet = await u.ctx.fns.plugins.checkUpdates({});
        expect(quiet).toMatchObject({ checked: 1, updates: [], errors: [] });
        expect(await dockUpdates.render(u.ctx)).toBeNull();
        const greet = async () => (await import(join(theirs, 'src', 'notes', 'hello.ts') + '?t=' + Math.random())).default({}, null, {});
        expect((await greet()).message).toBe('Hello, world!');

        // ── the author releases a new version ─────────────────────────────
        await expect(a.ctx.fns.plugins.release({ name: 'notes' })).rejects.toThrow('plugins.edit');
        await a.ctx.fns.plugins.edit({ name: 'notes' });
        await writeFile(join(dir, 'src', 'notes', 'hello.ts'), (await readFile(join(dir, 'src', 'notes', 'hello.ts'), 'utf8')).replace('Hello, ${to}!', 'Hi, ${to}!'));
        await writeFile(join(dir, 'src', 'notes', 'hello.test.ts'), (await readFile(join(dir, 'src', 'notes', 'hello.test.ts'), 'utf8')).replaceAll('Hello, ', 'Hi, '));
        git(dir, 'commit', '-qam', 'friendlier greeting');
        const rel = await a.ctx.fns.plugins.release({ name: 'notes' });
        expect(rel).toMatchObject({ version: '1.0.1', tag: 'v1.0.1', branch: 'main', at: 'tag', tests: { ran: true } });
        expect(git(remote, 'rev-parse', 'refs/tags/v1.0.1^{commit}')).toBe(rel.commit);
        // After a release the clone sits at the new tag, like an install — not left on the branch.
        expect(git(dir, 'describe', '--tags', '--exact-match')).toBe('v1.0.1');
        expect((await a.lock()).notes).toMatchObject({ tag: 'v1.0.1', previous: [{ tag: 'v1.0.0' }] });
        // The listing needs no change for a new version.
        expect(git(w.listingBare, 'log', '--format=%s')).toBe('notes 1.0.0\nlisting');

        // ── the other machine learns about the update without opening the catalog ──
        // The check goes by the lock (the listing is not consulted) and installs nothing.
        const found = await u.ctx.fns.plugins.checkUpdates({});
        expect(found.updates).toEqual([{ name: 'notes', mode: 'tag', from: 'v1.0.0', to: 'v1.0.1', installedCommit: done.commit }]);
        expect((await u.lock()).notes.tag).toBe('v1.0.0');
        expect(JSON.parse(await readFile(join(u.home, 'hyper', 'plugins.updates.json'), 'utf8')).updates).toEqual(found.updates);
        expect((await u.ctx.fns.plugins.pendingUpdates({})).updates.map((x: any) => `${x.name} ${x.to}`)).toEqual(['notes v1.0.1']);
        expect(await dockUpdates.render(u.ctx)).toEqual({ icon: 'ph-puzzle-piece', label: 'Plugin update: notes v1.0.1', href: '/plugins/listing', badge: 1 });
        // The author's own machine is already at the new release: nothing pending there.
        expect((await a.ctx.fns.plugins.checkUpdates({})).updates).toEqual([]);

        // ── takes it, rolls back ──────────────────────────────────────────
        expect((await u.ctx.fns.plugins.catalog({ q: 'notes', fresh: true })).plugins[0]).toMatchObject({ installed: '1.0.0', latest: '1.0.1', update: true });
        const up = await u.ctx.fns.plugins.install({ name: 'notes' });
        expect(up).toMatchObject({ operation: 'update', tag: 'v1.0.1' });
        expect(up.commits.some((c: string) => c.includes('friendlier greeting'))).toBe(true);
        expect(up.changed).toContain('src/notes/hello.ts');
        await u.ctx.fns.plugins.install({ name: 'notes', confirmed: true, expectedDigest: up.digest });
        expect((await greet()).message).toBe('Hi, world!');
        // Applied: the badge is gone at once, without another check (the record is older than the clone's move).
        expect((await u.ctx.fns.plugins.pendingUpdates({})).updates).toEqual([]);
        expect(await dockUpdates.render(u.ctx)).toBeNull();
        const back = await u.ctx.fns.plugins.gitInstall({ operation: 'rollback', name: 'notes' });
        await u.ctx.fns.plugins.gitInstall({ operation: 'rollback', name: 'notes', confirmed: true, expectedDigest: back.digest });
        expect((await greet()).message).toBe('Hello, world!');
        expect((await u.lock()).notes.tag).toBe('v1.0.0');
        // Rolled back: the update is on offer again as soon as the check runs.
        expect((await u.ctx.fns.plugins.checkUpdates({})).updates.map((x: any) => x.to)).toEqual(['v1.0.1']);

        // A clone following a branch is told about new commits; one pinned to a commit follows nothing.
        const br = await u.ctx.fns.plugins.install({ name: 'notes', branch: 'main' });
        await u.ctx.fns.plugins.install({ name: 'notes', branch: 'main', confirmed: true, expectedDigest: br.digest });
        expect((await u.ctx.fns.plugins.checkUpdates({})).updates).toEqual([]);
        await a.ctx.fns.plugins.edit({ name: 'notes' });
        await writeFile(join(dir, 'CHANGES.md'), 'next\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'notes for the next version'); git(dir, 'push', '-q', 'origin', 'main');
        const moved = await u.ctx.fns.plugins.checkUpdates({});
        expect(moved.updates).toMatchObject([{ name: 'notes', mode: 'branch', from: 'main', to: 'main +1', newCommits: 1 }]);
        expect((await dockUpdates.render(u.ctx) as any).label).toBe('Plugin update: notes main +1');
        const pin = await u.ctx.fns.plugins.install({ name: 'notes', commit: done.commit });
        await u.ctx.fns.plugins.install({ name: 'notes', commit: done.commit, confirmed: true, expectedDigest: pin.digest });
        expect((await u.ctx.fns.plugins.pendingUpdates({})).updates).toEqual([]);
        expect((await u.ctx.fns.plugins.checkUpdates({})).updates).toEqual([]);
    });
}, 180_000);

test('checkUpdates: an unreachable repository is reported and does not hide the others; no USER_PLUGINS means nothing to do', async () => {
    const w = await world();
    const u = w.user;
    await online(w.server, async () => {
        await w.author.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.' });
        const p = await w.author.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING });
        await w.author.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING, confirmed: true, expectedDigest: p.digest });
        await u.pullListing();
        const ip = await u.ctx.fns.plugins.install({ name: 'notes' });
        await u.ctx.fns.plugins.install({ name: 'notes', confirmed: true, expectedDigest: ip.digest });
        // A release that was withdrawn: this machine is at v1.0.1, the repository's newest tag is v1.0.0 again.
        // An older "latest" is not an update — the check never proposes going backwards.
        const dir = join(w.author.user, 'notes');
        await w.author.ctx.fns.plugins.edit({ name: 'notes' });
        await writeFile(join(dir, 'CHANGES.md'), 'x\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'next');
        await w.author.ctx.fns.plugins.release({ name: 'notes' });
        expect((await u.ctx.fns.plugins.checkUpdates({})).updates.map((x: any) => x.to)).toEqual(['v1.0.1']);
        const up = await u.ctx.fns.plugins.install({ name: 'notes' });
        await u.ctx.fns.plugins.install({ name: 'notes', confirmed: true, expectedDigest: up.digest });
        expect((await u.lock()).notes.tag).toBe('v1.0.1');
        git(join(w.server, 'team/notes.git'), 'tag', '-d', 'v1.0.1');
        expect((await u.ctx.fns.plugins.versions({ source: REPO, fresh: true }))[0].tag).toBe('v1.0.0');
        expect((await u.ctx.fns.plugins.checkUpdates({})).updates).toEqual([]);

        // A second lock entry whose server is gone.
        const { lock } = await u.ctx.fns.plugins.lockFile({});
        lock.plugins.gone = { repo: 'https://git.example.test/team/gone.git', tag: 'v1.0.0', commit: 'a'.repeat(40), previous: [] };
        await u.ctx.fns.plugins.lockFile({ lock });
        const r = await u.ctx.fns.plugins.checkUpdates({});
        expect(r.checked).toBe(2);
        expect(r.updates).toEqual([]);
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toStartWith('gone: git ls-remote failed for https://git.example.test/team/gone.git');
        expect((await u.ctx.fns.plugins.pendingUpdates({})).errors).toEqual(r.errors);
    });
    const bare: any = { env: {}, fns: { plugins: {} } };
    bare.fns.plugins.lockFile = (o: any) => (lockFile as any)(bare, null, o);
    expect(await (checkUpdates as any)(bare, null, {})).toMatchObject({ checked: 0, updates: [], errors: [] });
    expect(await (pendingUpdates as any)(bare, null, {})).toEqual({ checkedAt: null, updates: [], errors: [] });
}, 120_000);

test('publish refuses what would not be a clean first release, and a failed push leaves the clone as it was', async () => {
    const w = await world();
    const a = w.author;
    await online(w.server, async () => {
        await a.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.' });
        const dir = join(a.user, 'notes');
        const head = git(dir, 'rev-parse', 'HEAD');
        const remote = join(w.server, 'team/notes.git');

        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: 'https://git.example.test/team/absent.git' })).rejects.toThrow('Cannot reach https://git.example.test/team/absent.git');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: LISTING })).rejects.toThrow('https://git.example.test/team/listing.git is not empty (1 ref)');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, listing: REPO })).rejects.toThrow('is not a plugin listing: it needs plugins/<name>.json files and an index.json of format 2');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, listing: 'https://git.example.test/team/nolisting.git' })).rejects.toThrow('Cannot read the listing repository https://git.example.test/team/nolisting.git');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0' })).rejects.toThrow('Version must be X.Y.Z');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: 'https://user:pw@git.example.test/team/notes.git' })).rejects.toThrow('Unsupported plugin repository');
        await writeFile(join(dir, 'NOTES.md'), 'draft');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO })).rejects.toThrow('uncommitted changes — commit them first: NOTES.md');
        await rm(join(dir, 'NOTES.md'));
        // A failing test of the plugin stops the publication before anything is written.
        await writeFile(join(dir, 'src', 'notes', 'hello.test.ts'), 'import { test, expect } from "bun:test";\ntest("broken", () => { expect(1).toBe(2); });\n');
        git(dir, 'commit', '-qam', 'break the test');
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO })).rejects.toThrow('Tests of notes failed; nothing released');
        git(dir, 'reset', '-q', '--hard', head);

        // The server refuses the push (read-only repository): the tag, the remote and the release commit are undone.
        const preview = await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0' });
        expect(preview.listing).toEqual({ status: 'not-requested' });
        await chmod(remote, 0o555); for (const d of ['objects', 'refs', 'refs/heads', 'refs/tags']) await chmod(join(remote, d), 0o555);
        try {
            await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', confirmed: true, expectedDigest: preview.digest })).rejects.toThrow(/Push to .* failed.*Nothing published; the clone is as before/s);
        } finally { await chmod(remote, 0o755); for (const d of ['objects', 'refs', 'refs/heads', 'refs/tags']) await chmod(join(remote, d), 0o755); }
        expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
        expect(git(dir, 'remote')).toBe('');
        expect(git(dir, 'tag', '--list')).toBe('');
        expect(git(dir, 'status', '--porcelain')).toBe('');
        expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('0.1.0');
        expect(await a.lock()).toEqual({});

        // Once the server accepts pushes, the same call goes through; a listing without push rights does not undo it.
        const again = await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING });
        for (const d of ['', 'objects', 'refs', 'refs/heads']) await chmod(join(w.listingBare, d), 0o555);
        let done: any;
        try { done = await a.ctx.fns.plugins.publish({ name: 'notes', repo: REPO, version: '1.0.0', listing: LISTING, confirmed: true, expectedDigest: again.digest }); }
        finally { for (const d of ['', 'objects', 'refs', 'refs/heads']) await chmod(join(w.listingBare, d), 0o755); }
        expect(done.status).toBe('published');
        expect(done.listing.status).toBe('push-refused');
        expect(done.listing.detail).toContain('open a pull request to the listing');
        expect(git(remote, 'rev-parse', 'refs/tags/v1.0.0^{commit}')).toBe(done.commit);
        expect(git(w.listingBare, 'log', '--format=%s')).toBe('listing');
    });
}, 180_000);

test('GitHub: a missing repository is created only on confirm and only when asked; an existing one is never created over', async () => {
    const w = await world();
    const a = w.author;
    const calls: any[] = [];
    // github.com resolves to the local server too; gh is replaced by a stub that "creates" a bare repository there.
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${w.server}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' };
    const was = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
        a.ctx.fns.plugins.ghRepo = async (o: any) => {
            calls.push(o);
            const d = join(w.server, o.repo + '.git');
            const exists = await readdir(d).then(() => true, () => false);
            if (!o.create || exists) return { exists, created: false, url: `https://github.com/${o.repo}.git` };
            await mkdir(d, { recursive: true }); git(d, 'init', '-q', '--bare', '-b', 'main');
            return { exists: true, created: true, url: `https://github.com/${o.repo}.git`, visibility: o.visibility, canPush: true };
        };
        await a.ctx.fns.plugins.create({ name: 'notes', description: 'Keep short notes for the team.' });
        await expect(a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes' })).rejects.toThrow('github:acme/notes does not exist: create it, or repeat with createRepo: true');
        const preview = await a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes', createRepo: true, version: '1.0.0' });
        expect(preview).toMatchObject({ remote: 'missing', creates: { repo: 'acme/notes', visibility: 'private' }, repo: 'github:acme/notes', url: 'https://github.com/acme/notes.git' });
        expect(preview.packageChanges).toContain('repository: (none) → https://github.com/acme/notes');
        expect(calls.every(c => !c.create)).toBe(true);
        expect(await readdir(join(w.server)).then(l => l.includes('acme'))).toBe(false);
        // Listing a private repository is allowed, and said: people without access will see it and not be able to install it.
        const listed = await a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes', createRepo: true, version: '1.0.0', listing: w.listingBare });
        expect(listed.listing).toMatchObject({ status: 'will-add', detail: 'github:acme/notes is private: only people with access to it can install the plugin from this listing' });
        expect((await a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes', createRepo: true, visibility: 'public', version: '1.0.0', listing: w.listingBare })).listing.detail).toBeUndefined();
        // Asking for a public repository is another publication than the one reviewed.
        expect((await a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes', createRepo: true, visibility: 'public', version: '1.0.0' })).digest).not.toBe(preview.digest);

        const done = await a.ctx.fns.plugins.publish({ name: 'notes', repo: 'github:acme/notes', createRepo: true, version: '1.0.0', confirmed: true, expectedDigest: preview.digest });
        expect(done.status).toBe('published');
        expect(calls.filter(c => c.create)).toEqual([{ repo: 'acme/notes', create: true, visibility: 'private', description: 'Hyper plugin: Keep short notes for the team.' }]);
        expect(git(join(w.server, 'acme/notes.git'), 'rev-parse', 'refs/tags/v1.0.0^{commit}')).toBe(done.commit);
        expect((await a.lock()).notes.repo).toBe('github:acme/notes');
    } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}, 120_000);
