import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dropped from './dropped';
import listingPage from './listingPage';
import updatePage from '../update/$route__GET';
import dockUpdates from './$dock_updates';
import noteUpdate from './noteUpdate';
import start from './$start';
import { readFile } from 'node:fs/promises';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@l', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@l' };
function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...ENV } });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/**
 * A Hyper checkout with two commits. `old` ships five plugins in its tree; in `new` four of them have moved to their
 * own repositories (the folders are gone) and one stays. This is the fleet update of 2026-11-15 in small.
 */
async function hyper() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugins-dropped-')));
    roots.push(root);
    const repo = join(root, 'hyper'), user = join(root, 'home', '.hyper', 'user');
    await mkdir(join(repo, '.runtime'), { recursive: true }); await mkdir(user, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    const plugin = async (name: string, procs: Record<string, unknown>) => {
        await mkdir(join(repo, 'plugins', name, 'src', name), { recursive: true });
        await writeFile(join(repo, 'plugins', name, 'package.json'), JSON.stringify({ name, procs: { src: 'src', ...procs } }));
        await writeFile(join(repo, 'plugins', name, 'src', name, 'hello.ts'), 'export default async () => 1;');
    };
    await plugin('mermaid', { label: 'Mermaid', optional: true });      // optional, named in package.json modules
    await plugin('telegram', { label: 'Telegram', optional: true });    // optional, named in workspace.json
    await plugin('duckdb', { label: 'DuckDB', optional: true });        // optional, nobody asked for it here
    await plugin('icons', { label: 'Icons' });                          // always on
    await plugin('news', { label: 'News', optional: true });            // stays in the tree
    await writeFile(join(repo, '.gitignore'), '.runtime\nworkspace.json\nnode_modules\n');
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'hyper', procs: { modules: { mermaid: {}, news: {}, agent: false } } }));
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'old');
    const from = git(repo, 'rev-parse', 'HEAD');
    for (const n of ['mermaid', 'telegram', 'duckdb', 'icons']) git(repo, 'rm', '-rq', join('plugins', n));
    // What an update really leaves behind: an ignored node_modules in the folder of a plugin that left.
    await mkdir(join(repo, 'plugins', 'telegram', 'node_modules', 'x'), { recursive: true });
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'hyper', procs: { modules: { news: {} } } }));
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'new');
    const to = git(repo, 'rev-parse', 'HEAD');
    await writeFile(join(repo, 'workspace.json'), JSON.stringify({ modules: { telegram: {}, crme: { path: '/elsewhere' } } }));

    const listing = [
        { name: 'mermaid', label: 'Mermaid', description: 'd', source: 'github:acme/mermaid', listing: 'l' },
        { name: 'telegram', label: 'Telegram', description: 'd', source: 'github:acme/telegram', listing: 'l' },
    ];
    const ctx: any = {
        env: { USER_PLUGINS: user, HOME: join(root, 'home') },
        state: {},
        fns: {
            procs: { project: { projectRoot: () => repo, runtimeDir: () => join(repo, '.runtime'), workdir: () => repo } },
            git: { run: async (o: { args: string[]; dir: string }) => { const p = Bun.spawnSync(['git', ...o.args], { cwd: o.dir }); return { ok: p.exitCode === 0, code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() }; } },
            plugins: {
                listing: async () => ({ urls: ['l'], plugins: listing, errors: [] }),
                versions: async (o: { source: string }) => o.source === 'github:acme/mermaid' ? [{ tag: 'v1.0.1', version: '1.0.1', commit: 'c' }] : [{ tag: 'v2.0.0', version: '2.0.0', commit: 'c' }],
            },
        },
    };
    ctx.fns.plugins.dropped = (o: any) => dropped(ctx, null, o);
    ctx.fns.plugins.noteUpdate = (o: any) => noteUpdate(ctx, null, o);
    const receipt = (body: unknown) => writeFile(join(repo, '.runtime', 'update-result.json'), JSON.stringify(body));
    const install = async (name: string) => { await mkdir(join(user, name), { recursive: true }); await writeFile(join(user, name, 'package.json'), JSON.stringify({ name, procs: {} })); };
    return { repo, user, from, to, ctx, receipt, install };
}

test('dropped: plugins that left the tree between two commits, which of them this Hyper used, and what brings them back', async () => {
    const h = await hyper();
    const d = await dropped(h.ctx, null, { from: h.from, to: h.to });
    expect(d).toEqual({
        from: h.from, to: h.to,
        plugins: [
            { name: 'duckdb', label: 'DuckDB', mounted: false, installed: false },               // optional and never asked for: not a loss
            { name: 'icons', label: 'Icons', mounted: true, installed: false },                    // always on; in no listing
            { name: 'mermaid', label: 'Mermaid', mounted: true, installed: false, latest: '1.0.1' },
            { name: 'telegram', label: 'Telegram', mounted: true, installed: false, latest: '2.0.0' },
        ],
        missing: ['icons', 'mermaid', 'telegram'],
    });
    // `news` stayed in the tree; a module excluded with `false` is not "named".
    expect(d.plugins.map(p => p.name)).not.toContain('news');

    // Installed from the catalog: no longer missing.
    await h.install('telegram');
    expect((await dropped(h.ctx, null, { from: h.from, to: h.to })).missing).toEqual(['icons', 'mermaid']);
    // The other direction (a rollback), and a range where nothing left: nothing to say.
    expect((await dropped(h.ctx, null, { from: h.to, to: h.from })).plugins).toEqual([]);
    expect((await dropped(h.ctx, null, { from: h.to, to: h.to })).plugins).toEqual([]);
    // "*" in the modules means every optional plugin of the tree was mounted.
    await writeFile(join(h.repo, 'workspace.json'), JSON.stringify({ modules: { '*': {} } }));
    expect((await dropped(h.ctx, null, { from: h.from, to: h.to })).missing).toEqual(['duckdb', 'icons', 'mermaid']);
    await expect(dropped(h.ctx, null, { from: 'main; rm -rf /', to: h.to })).rejects.toThrow('commit SHAs');
});

test('dropped without arguments reads the last update the supervisor recorded; no record or a failed update says nothing', async () => {
    const h = await hyper();
    expect(await dropped(h.ctx, null, {})).toEqual({ from: null, to: null, plugins: [], missing: [] });
    await h.receipt({ ok: false, old: h.from, target: h.to, reason: 'new server failed health check' });
    expect((await dropped(h.ctx, null, {})).plugins).toEqual([]);
    await h.receipt({ ok: true, old: h.from, target: h.to, at: 1 });
    const d = await dropped(h.ctx, null, {});
    expect(d.from).toBe(h.from);
    expect(d.missing).toEqual(['icons', 'mermaid', 'telegram']);
    // An unreadable catalog does not hide the loss: only `latest` is unknown.
    h.ctx.fns.plugins.listing = async () => { throw new Error('offline'); };
    expect((await dropped(h.ctx, null, {})).plugins.find(p => p.name === 'mermaid')).toEqual({ name: 'mermaid', label: 'Mermaid', mounted: true, installed: false });
});

test('the update page names the plugins the update removes, before the button is pressed', async () => {
    const h = await hyper();
    Object.assign(h.ctx.fns, {
        update: { check: async () => ({ state: 'available', current: h.from, target: h.to, upstream: 'origin/main', ahead: 0, behind: 1, clean: true, checkedAt: 0, message: 'Update available' }) },
        auth: { csrfForms: async (o: { html: string }) => o.html },
    });
    h.ctx.env.HYPER_UPDATE_SUPERVISOR = 'run-service';
    const page: any = await updatePage(h.ctx, null, { req: new Request('http://localhost/update'), params: {} });
    expect(page.main).toContain('data-dropped-plugins');
    expect(page.main).toContain('Plugins this update removes from Hyper');
    expect(page.main).toContain('<code>mermaid</code> — Mermaid · in the catalog as 1.0.1');
    expect(page.main).toContain('<code>icons</code> — Icons · not in the catalog of this instance');
    expect(page.main).not.toContain('<code>duckdb</code>');                 // not in use here
    expect(page.main.indexOf('data-dropped-plugins')).toBeLessThan(page.main.indexOf('/update/apply'));
    // A failing check does not take the update page down.
    const noCheck = { ...h.ctx, fns: { ...h.ctx.fns, plugins: { ...h.ctx.fns.plugins, dropped: undefined } } };
    expect(((await updatePage(noCheck, null, { req: new Request('http://localhost/update'), params: {} })) as any).main).toContain('/update/apply');
    // An update that removes nothing in use shows no such section.
    await h.install('mermaid'); await h.install('telegram'); await h.install('icons');
    expect(((await updatePage(h.ctx, null, { req: new Request('http://localhost/update'), params: {} })) as any).main).not.toContain('data-dropped-plugins');
});

test('after the update the catalog page offers what went missing, and the Dock says so until it is back', async () => {
    const h = await hyper();
    await h.receipt({ ok: true, old: h.from, target: h.to, at: 1 });
    Object.assign(h.ctx.fns.plugins, { catalog: async () => ({ mount: h.user, urls: ['l'], errors: [], plugins: [] }), lockFile: async () => ({ path: '', lock: { plugins: {} } }), pendingUpdates: async () => ({ checkedAt: null, updates: [], errors: [] }) });
    const html = await listingPage(h.ctx, null, {});
    expect(html).toContain('data-dropped-plugins');
    expect(html).toContain('The last Hyper update removed 3 plugins this instance was using.');
    expect(html).toContain('Review install of mermaid 1.0.1');
    expect(html).toContain('Review install of telegram 2.0.0');
    expect(html).toContain('<code>icons</code> (not in a listing of this instance)');
    expect(html.indexOf('data-dropped-plugins')).toBeLessThan(html.indexOf('role="search"'));
    // A search result page and a review page stay as they were.
    expect(await listingPage(h.ctx, null, { q: 'charts' })).not.toContain('data-dropped-plugins');

    // A broken plugins.dropped (or a Hyper without it) never keeps the catalog from opening.
    const broken = { ...h.ctx, fns: { ...h.ctx.fns, plugins: { ...h.ctx.fns.plugins, dropped: undefined } } };
    expect(await listingPage(broken, null, {})).toContain('role="search"');
    expect(await listingPage({ ...h.ctx, fns: { ...h.ctx.fns, plugins: { ...h.ctx.fns.plugins, dropped: async () => { throw new Error('git is gone'); } } } }, null, {})).not.toContain('data-dropped-plugins');

    // The Dock: silent with nothing to say, loud when plugins are missing, ahead of ordinary updates.
    expect(await dockUpdates.render(h.ctx)).toBeNull();
    h.ctx.state.droppedPlugins = { at: 1, names: ['icons', 'mermaid', 'telegram'] };
    expect(await dockUpdates.render(h.ctx)).toEqual({ icon: 'ph-puzzle-piece', label: 'Removed by the last Hyper update, install from the catalog: icons, mermaid, telegram', href: '/plugins/listing', badge: '!' });
    h.ctx.state.droppedPlugins.names = [];
    expect(await dockUpdates.render(h.ctx)).toBeNull();
});

// Most of the fleet was updated from outside (git pull, restart): no supervisor receipt exists then. The start itself
// notices that the commit changed.
test('an update made from outside is noticed at start: the commit of the previous start is the base, and an older loss is not forgotten', async () => {
    const h = await hyper();
    const head = async () => JSON.parse(await readFile(join(h.repo, '.runtime', 'plugins-head.json'), 'utf8'));
    // First start ever on the OLD code: nothing to compare with.
    git(h.repo, 'checkout', '-q', h.from);
    expect(await noteUpdate(h.ctx, null, {})).toEqual({ head: h.from, previous: null, changed: false });
    expect(await dropped(h.ctx, null, {})).toMatchObject({ from: null, plugins: [] });
    // Somebody pulls and restarts.
    git(h.repo, 'checkout', '-q', h.to);
    expect(await noteUpdate(h.ctx, null, {})).toEqual({ head: h.to, previous: h.from, changed: true });
    expect((await dropped(h.ctx, null, {})).missing).toEqual(['icons', 'mermaid', 'telegram']);
    // A restart without an update changes nothing.
    expect(await noteUpdate(h.ctx, null, {})).toEqual({ head: h.to, previous: h.from, changed: false });
    // A second update while the loss of the first is still not repaired keeps the old base…
    await writeFile(join(h.repo, 'NOTES.md'), 'x'); git(h.repo, 'add', '-A'); git(h.repo, 'commit', '-qm', 'newer');
    const newer = git(h.repo, 'rev-parse', 'HEAD');
    expect(await noteUpdate(h.ctx, null, {})).toEqual({ head: newer, previous: h.from, changed: true });
    expect((await dropped(h.ctx, null, {})).missing).toEqual(['icons', 'mermaid', 'telegram']);
    // …and once everything is installed, the next update starts from where it really started.
    for (const n of ['icons', 'mermaid', 'telegram']) await h.install(n);
    expect((await dropped(h.ctx, null, {})).missing).toEqual([]);
    await writeFile(join(h.repo, 'NOTES.md'), 'y'); git(h.repo, 'add', '-A'); git(h.repo, 'commit', '-qm', 'newest');
    expect(await noteUpdate(h.ctx, null, {})).toMatchObject({ previous: newer, changed: true });
    expect((await head()).previous).toBe(newer);
    // Not a git checkout: nothing is recorded and nothing breaks.
    const bare: any = { ...h.ctx, fns: { ...h.ctx.fns, git: { run: async () => ({ ok: false, code: 128, stdout: '', stderr: 'not a git repository' }) } } };
    expect(await noteUpdate(bare, null, {})).toEqual({ head: null, previous: null, changed: false });
});

test('start: notes the update, puts what is missing on the Dock and into the log, and does not wait for it', async () => {
    const h = await hyper();
    git(h.repo, 'checkout', '-q', h.from); await noteUpdate(h.ctx, null, {});
    git(h.repo, 'checkout', '-q', h.to);
    const warned: any[] = [];
    let watching = 0;
    Object.assign(h.ctx.fns.plugins, { watchClones: async () => { watching++; return { watching: true }; }, pendingUpdates: async () => ({ checkedAt: null, updates: [], errors: [] }) });
    h.ctx.fns.procs.log = { warn: (o: any) => warned.push(o) };
    // A slow catalog must not hold the start.
    const listing = h.ctx.fns.plugins.listing;
    h.ctx.fns.plugins.listing = async () => { await Bun.sleep(150); return listing(); };
    const t0 = Date.now();
    expect(await start(h.ctx, null) as unknown).toEqual({ watching: true });
    expect(Date.now() - t0).toBeLessThan(120);
    expect(watching).toBe(1);
    for (let i = 0; i < 100 && !h.ctx.state.droppedPlugins; i++) await Bun.sleep(20);
    expect(h.ctx.state.droppedPlugins.names).toEqual(['icons', 'mermaid', 'telegram']);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ event: 'plugins.dropped' });
    expect(warned[0].msg).toContain('icons, mermaid, telegram');
    expect(warned[0].msg).toContain('/plugins/listing');
    expect((await dockUpdates.render(h.ctx) as any).label).toContain('Removed by the last Hyper update');
    await expect(start(h.ctx, {} as any)).rejects.toThrow('lifecycle-only');
});
