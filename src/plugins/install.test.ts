import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gitInstall from './gitInstall';
import lockFile from './lockFile';
import cloneStatus from './cloneStatus';
import inspectPackage from './inspectPackage';
import listing from './listing';
import versions from './versions';
import catalog from './catalog';
import install from './install';
import uninstall from './uninstall';
import branchUpdates from './branchUpdates';
import cloneDir from './cloneDir';
import listingPage from './listingPage';
import cloneBadge from './cloneBadge';
import repoUrl from './repoUrl';
import remotePackage from './remotePackage';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
}

/** Local git repos (base; chart requires base; lonely requires missing), a file:// listing and an empty USER_PLUGINS. */
async function world(extra: Array<'ranges' | 'scripts'> = []) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugins-install-')));
    roots.push(root);
    const repo = async (name: string, releases: string[], requires: string[] | Record<string, string> = [], more: { pkg?: Record<string, unknown>; files?: Record<string, string>; lock?: boolean } = {}) => {
        const dir = join(root, 'repos', name);
        await mkdir(join(dir, 'src', name), { recursive: true });
        git(dir, 'init', '-q');
        for (const v of releases) {
            await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: v, procs: { requires }, ...more.pkg }));
            await writeFile(join(dir, 'src', name, 'version.ts'), `export default async () => ${JSON.stringify(v)};`);
            for (const [f, c] of Object.entries(more.files ?? {})) { await mkdir(join(dir, f, '..'), { recursive: true }); await writeFile(join(dir, f), c); }
            // The author's `bun install`: bun.lock is committed, node_modules is not.
            if (more.lock) {
                const p = Bun.spawnSync([process.execPath, 'install', '--ignore-scripts'], { cwd: dir, env: { ...process.env, BUN_BE_BUN: '1' } });
                if (p.exitCode) throw new Error(p.stderr.toString());
                await rm(join(dir, 'node_modules'), { recursive: true, force: true });
            }
            git(dir, 'add', '-A'); git(dir, 'commit', '-qm', v); git(dir, 'tag', 'v' + v);
        }
        git(dir, 'tag', 'nightly');
        return { name, label: name, description: `the ${name} plugin`, source: `git+file://${dir}` };
    };
    const entries = [
        await repo('base', ['1.0.0', '1.2.0', '1.10.0']), await repo('chart', ['2.0.0'], ['base']), await repo('lonely', ['1.0.0'], ['missing']),
        // Version ranges: tilde wants base 1.2.x, future a base 3 that does not exist.
        ...(extra.includes('ranges') ? [await repo('tilde', ['1.0.0'], { base: '~1.2' }), await repo('future', ['1.0.0'], { base: '^3' })] : []),
        // An npm package vendored in the repository (no network) whose postinstall the plugin trusts.
        ...(extra.includes('scripts') ? [await repo('builder', ['1.0.0'], [], {
            pkg: { dependencies: { leaf: 'file:./vendor/leaf' }, trustedDependencies: ['leaf'] }, lock: true,
            files: { 'vendor/leaf/package.json': JSON.stringify({ name: 'leaf', version: '1.0.0', main: 'index.js', scripts: { postinstall: 'echo built > built.txt' } }), 'vendor/leaf/index.js': 'module.exports = 1;' },
        })] : []),
    ];
    const index = join(root, 'index.json');
    await writeFile(index, JSON.stringify({ format: 2, plugins: entries }));
    const user = join(root, 'hyper', 'user');
    const ctx: any = {
        env: { USER_PLUGINS: user, HOME: root },
        state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
        fns: {
            settings: { get: async () => ['file://' + index] },
            procs: { modules: { reload: async () => {} } },
            plugins: {},
        },
    };
    for (const [k, f] of Object.entries({ gitInstall, lockFile, cloneStatus, inspectPackage, listing, versions, catalog, install, uninstall, branchUpdates, cloneDir, listingPage, cloneBadge, repoUrl, remotePackage }))
        ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
    const deps = async () => JSON.parse(await readFile(join(root, 'hyper', 'plugins.lock.json'), 'utf8').catch(() => '{"plugins":{}}')).plugins;
    return { ctx, user, deps, root };
}

test('versions: semver tags only, newest first by number', async () => {
    const w = await world();
    const ctx = w.ctx;
    const { plugins } = await ctx.fns.plugins.listing({});
    const list = await ctx.fns.plugins.versions({ source: plugins[0].source });
    expect(list.map((t: any) => t.version)).toEqual(['1.10.0', '1.2.0', '1.0.0']);
    expect(list[0].commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(ctx.fns.plugins.versions({ source: 'npm:x' })).rejects.toThrow('Unsupported plugin repository');
    await expect(ctx.fns.plugins.versions({ source: 'http://example.org/x' })).rejects.toThrow('Unsupported plugin repository');
});

test('install pulls in required plugins from the listing; catalog shows state; uninstall guards dependents', async () => {
    const w = await world();
    const ctx = w.ctx;
    let cat = await ctx.fns.plugins.catalog({ q: 'chart' });
    expect(cat.plugins.map((p: any) => [p.name, p.latest, p.installed ?? null])).toEqual([['chart', '2.0.0', null]]);

    const preview = await ctx.fns.plugins.install({ name: 'chart' });
    expect(preview.status).toBe('preview');
    expect(preview.tag).toBe('v2.0.0');
    expect(preview.repo).toStartWith('git+file://');
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
    const dir = join(w.user, '..', '..');
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
    const dir = join(w.user, 'base');
    for (const mounted of [dir, join(dir, 'src')]) {
        w.ctx.state.procs.modules = [{ name: 'base', dir: mounted, namespaces: ['base'] }];
        expect((await ctx.fns.plugins.install({ name: 'base' })).operation).toBe('update');
    }
    w.ctx.state.procs.modules = [{ name: 'base', dir: join(w.user, '..', 'elsewhere', 'base'), namespaces: ['base'] }];
    await expect(ctx.fns.plugins.install({ name: 'base' })).rejects.toThrow('Namespace collision: base is provided by base');
});

test('dev mode through install: follow a branch, see "+N new" in the catalog, update by preview; pin a commit; back to a release', async () => {
    const w = await world();
    const ctx = w.ctx;
    const repo = join(w.root, 'repos', 'base');
    const branch = Bun.spawnSync(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd: repo }).stdout.toString().trim();
    await expect(ctx.fns.plugins.install({ name: 'base', version: '1.2.0', branch })).rejects.toThrow('one of');
    const p = await ctx.fns.plugins.install({ name: 'base', branch });
    expect(p).toMatchObject({ operation: 'install', branch });
    await ctx.fns.plugins.install({ name: 'base', branch, confirmed: true, expectedDigest: p.digest });
    let entry = (await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0];
    expect(entry).toMatchObject({ mode: 'branch', branch, newCommits: 0, update: false });
    expect(ctx.fns.plugins.cloneBadge({ git: entry.git }).map((b: any) => b.label)).toEqual([`${branch} · ${p.commit.slice(0, 7)}`]);

    await writeFile(join(repo, 'src', 'base', 'version.ts'), 'export default async () => "dev";');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'dev work');
    entry = (await ctx.fns.plugins.catalog({ q: 'base', fresh: true })).plugins[0];
    expect(entry).toMatchObject({ mode: 'branch', newCommits: 1, update: true });
    expect(ctx.fns.plugins.cloneBadge({ git: entry.git }).map((b: any) => b.label)).toContain('+1 new');
    const page = await ctx.fns.plugins.listingPage({ q: 'base' });
    expect(page).toContain(`Update ${branch} (+1 new)`);

    const up = await ctx.fns.plugins.install({ name: 'base' });
    expect(up).toMatchObject({ operation: 'update', branch, changed: ['src/base/version.ts'] });
    expect(up.commits[0]).toContain('dev work');
    const review = await ctx.fns.plugins.listingPage({ change: up });
    expect(review).toContain('New commits · 1');
    expect(review).toContain(`name="branch" value="${branch}"`);
    await ctx.fns.plugins.install({ name: 'base', branch, confirmed: true, expectedDigest: up.digest });
    expect((await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0]).toMatchObject({ newCommits: 0, update: false });

    const v12 = Bun.spawnSync(['git', 'rev-parse', 'v1.2.0^{commit}'], { cwd: repo }).stdout.toString().trim();
    const pin = await ctx.fns.plugins.install({ name: 'base', commit: v12.slice(0, 8) });
    await ctx.fns.plugins.install({ name: 'base', commit: v12.slice(0, 8), confirmed: true, expectedDigest: pin.digest });
    entry = (await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0];
    expect(entry).toMatchObject({ mode: 'commit', commit: v12, update: false, installed: '1.2.0' });
    expect(ctx.fns.plugins.cloneBadge({ git: entry.git }).map((b: any) => b.label)).toEqual([v12.slice(0, 7)]);
    await expect(ctx.fns.plugins.install({ name: 'base' })).rejects.toThrow('nothing to update');
    const rel = await ctx.fns.plugins.install({ name: 'base', version: '1.10.0' });
    await ctx.fns.plugins.install({ name: 'base', version: '1.10.0', confirmed: true, expectedDigest: rel.digest });
    expect((await w.deps()).base).toMatchObject({ tag: 'v1.10.0', previous: [{ branch }, { branch }, { commit: v12 }] });
});

test('a version range in procs.requires picks the newest matching release, guards updates, and is shown', async () => {
    const w = await world(['ranges']);
    const ctx = w.ctx;
    await expect(ctx.fns.plugins.install({ name: 'future' })).rejects.toThrow('future requires base ^3, but base has only 1.10.0, 1.2.0, 1.0.0');

    const preview = await ctx.fns.plugins.install({ name: 'tilde' });
    expect(preview.companions?.map((c: any) => [c.name, c.version])).toEqual([['base', '1.2.0']]);
    expect(preview.plugin.requiresRanges).toEqual({ base: '~1.2' });
    expect(await ctx.fns.plugins.listingPage({ change: preview })).toContain('<code>base ~1.2</code>');
    await ctx.fns.plugins.install({ name: 'tilde', confirmed: true, expectedDigest: preview.digest });
    expect((await w.deps()).base.tag).toBe('v1.2.0');
    const cat = await ctx.fns.plugins.catalog({});
    expect(cat.plugins.find((p: any) => p.name === 'tilde').requires).toEqual(['base ~1.2']);
    expect(cat.plugins.find((p: any) => p.name === 'base')).toMatchObject({ installed: '1.2.0', latest: '1.10.0', update: true });

    // The catalog offers base 1.10.0, but tilde's range forbids it; inside the range nothing is in the way.
    await expect(ctx.fns.plugins.install({ name: 'base' })).rejects.toThrow('tilde requires base ~1.2; base 1.10.0 does not satisfy it');
    expect((await w.deps()).base.tag).toBe('v1.2.0');
    expect((await ctx.fns.plugins.install({ name: 'base', version: '1.2.0' })).status).toBe('preview');
});

test('a required plugin that is already installed outside the range is not moved: the preview says to switch it', async () => {
    const w = await world(['ranges']);
    const ctx = w.ctx;
    const base = await ctx.fns.plugins.install({ name: 'base' });
    await ctx.fns.plugins.install({ name: 'base', confirmed: true, expectedDigest: base.digest });
    w.ctx.state.procs.modules.push({ name: 'base', dir: join(w.user, 'base', 'src'), namespaces: ['base'] });
    await expect(ctx.fns.plugins.install({ name: 'tilde' })).rejects.toThrow('tilde requires base ~1.2, but base 1.10.0 is installed — switch base to a matching version first');
    expect(Object.keys(await w.deps())).toEqual(['base']);
});

test('trusted npm install scripts: the review names them before confirm, and only confirm runs them', async () => {
    const w = await world(['scripts']);
    const ctx = w.ctx;
    const preview = await ctx.fns.plugins.install({ name: 'builder' });
    expect(preview.installScripts).toEqual([{ plugin: 'builder', package: 'leaf', scripts: ['postinstall: echo built > built.txt'] }]);
    const review = await ctx.fns.plugins.listingPage({ change: preview });
    expect(review).toContain('data-install-scripts');
    expect(review).toContain('Confirming runs the install scripts of this npm package');
    expect(review).toContain('<code>postinstall: echo built &gt; built.txt</code>');
    const done = await ctx.fns.plugins.install({ name: 'builder', confirmed: true, expectedDigest: preview.digest });
    expect(await readdir(join(w.user, 'builder', 'node_modules', 'leaf'))).toContain('built.txt');
    expect(await ctx.fns.plugins.listingPage({ change: done })).toContain('Ran the install scripts of this npm package');
});

/** Makes git resolve https://git.example.test/<path> to local repositories for the duration of fn — a stand-in for a company git server, no network. */
async function withServer<T>(reposDir: string, fn: () => Promise<T>): Promise<T> {
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${reposDir}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://git.example.test/' };
    const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

test('a plugin on a git server that is not GitHub: listed by its https address, installed with what it requires, updated and rolled back', async () => {
    const w = await world();
    const ctx = w.ctx;
    // The same repositories, listed the way a company server would publish them (no github: anywhere).
    const index = join(w.root, 'company.json');
    const entry = (name: string) => ({ name, label: name, description: `the ${name} plugin`, source: `https://git.example.test/${name}` });
    await writeFile(index, JSON.stringify({ format: 2, plugins: [entry('base'), entry('chart'), { ...entry('scp'), source: 'git@git.example.test:team/scp.git' }, { ...entry('creds'), source: 'https://user:secret@git.example.test/creds' }, { ...entry('here'), source: 'git+file:///tmp/here' }] }));
    ctx.fns.settings.get = async () => ['https://listing.example.test/index.json'];
    // A remote listing is read with fetch; serve this one from the file.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: any) => String(u) === 'https://listing.example.test/index.json' ? new Response(await readFile(index, 'utf8')) : new Response('', { status: 404 })) as typeof fetch;
    try {
        await withServer(join(w.root, 'repos'), async () => {
            const listing = await ctx.fns.plugins.listing({});
            expect(listing.plugins.map((p: any) => [p.name, p.source])).toEqual([
                ['base', 'https://git.example.test/base'], ['chart', 'https://git.example.test/chart'], ['scp', 'git@git.example.test:team/scp.git'],
            ]);
            // Credentials in an address and a local path in a remote listing are refused, each named.
            expect(listing.errors).toEqual(['creds: invalid entry in https://listing.example.test/index.json', 'here: invalid entry in https://listing.example.test/index.json']);

            expect((await ctx.fns.plugins.versions({ source: 'https://git.example.test/base' })).map((t: any) => t.version)).toEqual(['1.10.0', '1.2.0', '1.0.0']);
            const preview = await ctx.fns.plugins.install({ name: 'chart' });
            expect(preview.repo).toBe('https://git.example.test/chart');
            expect(preview.companions?.map((c: any) => [c.name, c.repo, c.version])).toEqual([['base', 'https://git.example.test/base', '1.10.0']]);
            await ctx.fns.plugins.install({ name: 'chart', confirmed: true, expectedDigest: preview.digest });
            expect(await w.deps()).toMatchObject({ chart: { repo: 'https://git.example.test/chart', tag: 'v2.0.0' }, base: { repo: 'https://git.example.test/base', tag: 'v1.10.0' } });

            // origin of the clone is that server; it is not taken for a fork of itself, whatever the spelling.
            const cat = await ctx.fns.plugins.catalog({});
            const base = cat.plugins.find((p: any) => p.name === 'base');
            expect([base.installed, base.latest, base.update, base.git.fork]).toEqual(['1.10.0', '1.10.0', false, false]);

            const old = await ctx.fns.plugins.gitInstall({ operation: 'update', name: 'base', tag: 'v1.2.0' });
            await ctx.fns.plugins.gitInstall({ operation: 'update', name: 'base', tag: 'v1.2.0', confirmed: true, expectedDigest: old.digest });
            expect((await ctx.fns.plugins.catalog({ q: 'base' })).plugins[0]).toMatchObject({ installed: '1.2.0', update: true });
            const back = await ctx.fns.plugins.gitInstall({ operation: 'rollback', name: 'base' });
            await ctx.fns.plugins.gitInstall({ operation: 'rollback', name: 'base', confirmed: true, expectedDigest: back.digest });
            expect((await w.deps()).base.tag).toBe('v1.10.0');
        });
    } finally { globalThis.fetch = realFetch; }
});

test('remotePackage reads package.json at a tag, a branch and a commit with one shallow fetch; a missing ref or file is told apart', async () => {
    const w = await world();
    const ctx = w.ctx;
    const repo = 'git+file://' + join(w.root, 'repos', 'chart');
    const at = await ctx.fns.plugins.remotePackage({ repo, ref: 'refs/tags/v2.0.0' });
    expect(at.package).toMatchObject({ name: 'chart', version: '2.0.0', procs: { requires: ['base'] } });
    expect(at.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await ctx.fns.plugins.remotePackage({ repo, ref: at.commit })).package?.version).toBe('2.0.0');
    const branch = Bun.spawnSync(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd: join(w.root, 'repos', 'chart') }).stdout.toString().trim();
    expect((await ctx.fns.plugins.remotePackage({ repo, ref: `refs/heads/${branch}` })).commit).toBe(at.commit);
    await expect(ctx.fns.plugins.remotePackage({ repo, ref: 'refs/tags/v9.9.9' })).rejects.toThrow('Could not read refs/tags/v9.9.9');
    await expect(ctx.fns.plugins.remotePackage({ repo, ref: 'v2.0.0' })).rejects.toThrow('Ref must be');
    await expect(ctx.fns.plugins.remotePackage({ repo, ref: 'refs/tags/../../x' })).rejects.toThrow('Ref must be');
    // A repository without package.json at that ref: the ref is fine, the file is not there.
    const bare = join(w.root, 'repos', 'empty');
    await mkdir(bare, { recursive: true }); git(bare, 'init', '-q');
    await writeFile(join(bare, 'README.md'), 'x'); git(bare, 'add', '-A'); git(bare, 'commit', '-qm', 'x'); git(bare, 'tag', 'v1.0.0');
    expect((await ctx.fns.plugins.remotePackage({ repo: 'git+file://' + bare, ref: 'refs/tags/v1.0.0' })).package).toBeNull();
});

test('a plugin that is in no listing is updated by name through the repository its lock records', async () => {
    const w = await world();
    const ctx = w.ctx;
    // A repository nobody listed, installed by its address.
    const dir = join(w.root, 'repos', 'solo');
    await mkdir(join(dir, 'src', 'solo'), { recursive: true }); git(dir, 'init', '-q');
    for (const v of ['1.0.0', '1.1.0']) {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'solo', version: v, procs: {} }));
        await writeFile(join(dir, 'src', 'solo', 'version.ts'), `export default async () => ${JSON.stringify(v)};`);
        git(dir, 'add', '-A'); git(dir, 'commit', '-qm', v); git(dir, 'tag', 'v' + v);
    }
    await expect(ctx.fns.plugins.install({ name: 'solo' })).rejects.toThrow('solo is not in the plugin listing: install it from its repository with plugins.gitInstall');
    const first = await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'solo', repo: 'git+file://' + dir, tag: 'v1.0.0' });
    await ctx.fns.plugins.gitInstall({ operation: 'install', name: 'solo', repo: 'git+file://' + dir, tag: 'v1.0.0', confirmed: true, expectedDigest: first.digest });
    const up = await ctx.fns.plugins.install({ name: 'solo' });
    expect(up).toMatchObject({ operation: 'update', tag: 'v1.1.0', repo: 'git+file://' + dir });
    await ctx.fns.plugins.install({ name: 'solo', confirmed: true, expectedDigest: up.digest });
    expect((await w.deps()).solo).toMatchObject({ tag: 'v1.1.0', previous: [{ tag: 'v1.0.0' }] });
    // Still not something a stranger can install by name.
    expect((await ctx.fns.plugins.catalog({})).plugins.some((p: any) => p.name === 'solo')).toBe(false);
});
