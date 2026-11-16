import { test, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
import clonePanel from './clonePanel';
import installed from './installed';
import readMetadata from './readMetadata';
import validateTree from './validateTree';
import lockFile from './lockFile';
import repoUrl from './repoUrl';
import remotePackage from './remotePackage';
import home from './home';
import listingEntryOf from './listingEntryOf';
import listingWrite from './listingWrite';
import secretScan from './secretScan';
import addToListing from './addToListing';
import unpublish from './unpublish';
import publishReady from './publishReady';
import route from './$route_$name_git_POST';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@l', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@l' };
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } globalThis.fetch = realFetch; });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...ENV } });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}
const SERVER = 'https://git.mesh.test';
const LISTING = `${SERVER}/git/shared/plugins-index.git`;
const J = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/**
 * A private network in small: one git server (a folder of bare repositories behind https://git.mesh.test/git/, with
 * the two HTTP answers a hyper-git server gives — whoami and create), a shared listing on it with one plugin of the
 * team "fhir", and Hypers that each have their own USER_PLUGINS, lock and identity.
 */
async function network() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'plugin-share-')));
    roots.push(root);
    const server = join(root, 'server');
    const bare = async (id: string) => { const d = join(server, id + '.git'); await mkdir(d, { recursive: true }); git(d, 'init', '-q', '--bare', '-b', 'main'); return d; };
    const listingBare = await bare('shared/plugins-index');
    const seed = join(root, 'seed');
    await mkdir(join(seed, 'plugins'), { recursive: true }); git(seed, 'init', '-q', '-b', 'main');
    const fhirchat = { name: 'fhirchat', label: 'FHIR Chat', description: 'Search the FHIR chat.', source: `${SERVER}/git/fhir/plugins/fhirchat.git` };
    await writeFile(join(seed, 'plugins', 'fhirchat.json'), J(fhirchat));
    await writeFile(join(seed, 'index.json'), J({ format: 2, plugins: [fhirchat] }));
    await writeFile(join(seed, 'README.md'), 'listing\n');
    git(seed, 'add', '-A'); git(seed, 'commit', '-qm', 'listing'); git(seed, 'push', '-q', listingBare, 'main');
    const index = () => JSON.parse(git(listingBare, 'show', 'main:index.json'));
    const requests: string[] = [];
    let whoamiStatus = 200;

    /** A Hyper of the network. `identity` is what the server sees it as; `homeSetting` is its plugins.home. */
    const hyper = (who: string, identity: { kind: 'server'; tenant: string } | { kind: 'person'; email: string }, homeSetting: unknown = SERVER) => {
        const dir = join(root, who);
        let reloads = 0;
        const ctx: any = {
            env: { USER_PLUGINS: join(dir, 'hyper', 'user'), HOME: dir },
            state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
            fns: {
                settings: { get: async (o: { key: string }) => o.key === 'home' ? ctx.homeSetting : [LISTING] },
                auth: { csrfField: async () => '<input type="hidden" name="_csrf" value="tok">', verifyCsrf: async ({ token }: any) => token === 'tok' },
                procs: { modules: { reload: async () => { reloads++; } }, project: { projectRoot: () => join(import.meta.dir, '..', '..') } },
                plugins: { ghRepo: async () => { throw new Error('gh must not be called inside the network'); } },
            },
        };
        ctx.homeSetting = homeSetting;
        ctx.identity = identity;
        for (const [k, f] of Object.entries({ home, listingEntryOf, listingWrite, secretScan, addToListing, unpublish, publishReady, create, publish, release, releaseCheck, edit, gitInit, gitInstall, install, catalog, listing, versions, branchUpdates, inspectPackage, cloneStatus, cloneDir, cloneBadge, clonePanel, installed, readMetadata, validateTree, lockFile, repoUrl, remotePackage }))
            ctx.fns.plugins[k] = (o: any) => (f as any)(ctx, null, o);
        // The server's "create a repository": only under the caller's own tenant (a person: anywhere), like hyper-git.
        ctx.fns.plugins.hyperGitRepo = async (o: { repo: string; create?: boolean }) => {
            const m = /^https:\/\/git\.mesh\.test\/git\/(.+?)(?:\.git)?$/.exec(o.repo);
            if (!m) return { match: false };
            const id = m[1]!, d = join(server, id + '.git'), exists = existsSync(d);
            if (!o.create) return { match: true, server: 'git.mesh.test', id, exists };
            requests.push(`create ${id} as ${who}`);
            if (ctx.identity.kind === 'server' && !id.startsWith(ctx.identity.tenant + '/')) throw new Error(`git.mesh.test refused to create ${id} (HTTP 403): this machine may create repositories only under its own team`);
            if (!exists) { await mkdir(d, { recursive: true }); git(d, 'init', '-q', '--bare', '-b', 'main'); }
            return { match: true, server: 'git.mesh.test', id, exists: true, created: !exists };
        };
        const lock = async () => JSON.parse(await readFile(join(dir, 'hyper', 'plugins.lock.json'), 'utf8').catch(() => '{"plugins":{}}')).plugins;
        const use = () => { current = ctx; };
        return { ctx, dir, user: ctx.env.USER_PLUGINS as string, lock, reloads: () => reloads, use };
    };
    // One process stands for every Hyper: `current` is the one whose request the "server" is answering.
    let current: any = null;
    globalThis.fetch = (async (input: any) => {
        const url = String(input?.url ?? input);
        requests.push(url);
        if (url !== `${SERVER}/api/whoami`) return new Response('not found', { status: 404 });
        if (whoamiStatus !== 200) return new Response('no', { status: whoamiStatus });
        const i = current.identity;
        const tenant = i.kind === 'server' ? i.tenant : null;
        return Response.json({
            kind: i.kind, id: i.kind === 'server' ? `spiffe://hn/${i.tenant}/dojo` : `user:${i.email}`, ...(i.kind === 'person' ? { email: i.email } : {}),
            tenant, owners: tenant ? [tenant] : [], anyOwner: i.kind === 'person', publicUrl: SERVER, pluginRepo: `${SERVER}/git/<owner>/plugins/<name>.git`,
            pluginCatalog: { repo: 'shared/plugins-index', url: LISTING, read: true, push: true, entrySource: tenant ? `${SERVER}/git/${tenant}/plugins/<name>.git` : null },
        });
    }) as typeof fetch;
    return { root, server, listingBare, index, requests, hyper, setWhoami: (s: number) => { whoamiStatus = s; } };
}
/** Runs fn with https://git.mesh.test/git/ resolving to the local server folder. */
async function online<T>(server: string, fn: () => Promise<T>): Promise<T> {
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${server}/.insteadOf`, GIT_CONFIG_VALUE_0: `${SERVER}/git/` };
    const was = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const fresh = (ctx: any) => { ctx.state.pluginHome = undefined; ctx.state.pluginListingRepos?.clear(); ctx.state.pluginVersions?.clear(); };

test('home: the server says who this Hyper is — a server publishes under its own team, a person needs an owner in the setting', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    atomic.use();
    expect(await atomic.ctx.fns.plugins.home({})).toEqual({
        configured: true, ready: true, server: SERVER, owner: 'atomic', repo: `${SERVER}/git/atomic/plugins/<name>.git`, listing: LISTING,
        identity: { kind: 'server', id: 'spiffe://hn/atomic/dojo' }, publishedBy: 'spiffe://hn/atomic/dojo', problems: [],
    });
    // Asked once: the answer is kept for a few minutes; `fresh` asks again; `offline` never asks.
    const asked = () => n.requests.filter(r => r.endsWith('/api/whoami')).length;
    await atomic.ctx.fns.plugins.home({}); expect(asked()).toBe(1);
    await atomic.ctx.fns.plugins.home({ fresh: true }); expect(asked()).toBe(2);
    expect(await atomic.ctx.fns.plugins.home({ offline: true })).toEqual({ configured: true, ready: false, server: SERVER, problems: [] });
    expect(asked()).toBe(2);
    // A server cannot claim another team's name: the setting does not override the server.
    atomic.ctx.homeSetting = { server: SERVER, owner: 'fhir' }; fresh(atomic.ctx);
    const claim = await atomic.ctx.fns.plugins.home({});
    expect(claim.ready).toBe(false);
    expect(claim.problems[0]).toContain('may publish under "atomic", not under "fhir"');

    // Several Hypers of one machine reach the server as one person: the owner comes from the setting, and the
    // person is what gets recorded as the publisher.
    const crm = n.hyper('crm', { kind: 'person', email: 'nik@example.test' });
    crm.use();
    const anon = await crm.ctx.fns.plugins.home({});
    expect(anon.ready).toBe(false);
    expect(anon.problems[0]).toContain('reaches https://git.mesh.test as the person nik@example.test, not as a server of its own: set owner in plugins.home');
    crm.ctx.homeSetting = { server: SERVER, owner: 'crm' }; fresh(crm.ctx);
    expect(await crm.ctx.fns.plugins.home({})).toMatchObject({ ready: true, owner: 'crm', repo: `${SERVER}/git/crm/plugins/<name>.git`, listing: LISTING, identity: { kind: 'person', id: 'user:nik@example.test' }, publishedBy: 'nik@example.test', problems: [] });
    expect(await crm.ctx.fns.plugins.home({ offline: true })).toMatchObject({ ready: true, owner: 'crm' });

    // Not set, malformed, unreachable, not a hyper-git server.
    crm.ctx.homeSetting = null;
    expect(await crm.ctx.fns.plugins.home({})).toEqual({ configured: false, ready: false, problems: ['plugins.home is not set: this Hyper has no place of its own to publish to'] });
    for (const bad of ['git.mesh.test', 'http://git.mesh.test', `${SERVER}/git`, { server: 'nope' }]) {
        crm.ctx.homeSetting = bad;
        expect((await crm.ctx.fns.plugins.home({})).problems[0]).toContain('must be the https address of the git server');
    }
    crm.ctx.homeSetting = { server: SERVER, owner: 'Not Valid' };
    expect((await crm.ctx.fns.plugins.home({})).problems[0]).toContain('owner must be a lowercase name');
    // The env form: PLUGIN_HOME holds JSON as text, or just the address with a trailing slash.
    crm.ctx.homeSetting = JSON.stringify({ server: SERVER, owner: 'crm' }); fresh(crm.ctx);
    expect(await crm.ctx.fns.plugins.home({})).toMatchObject({ ready: true, owner: 'crm' });
    atomic.use(); atomic.ctx.homeSetting = SERVER + '/'; fresh(atomic.ctx);
    expect(await atomic.ctx.fns.plugins.home({})).toMatchObject({ ready: true, owner: 'atomic', server: SERVER });
    // The network does not let this Hyper reach the server: said so; an owner in the setting still lets it try, unconfirmed.
    n.setWhoami(403); fresh(atomic.ctx);
    const denied = await atomic.ctx.fns.plugins.home({});
    expect(denied.ready).toBe(false);
    expect(denied.problems[0]).toContain('refused to say who this Hyper is (HTTP 403)');
    atomic.ctx.homeSetting = { server: SERVER, owner: 'atomic', listing: LISTING }; fresh(atomic.ctx);
    expect(await atomic.ctx.fns.plugins.home({})).toMatchObject({ ready: true, owner: 'atomic', listing: LISTING, problems: [expect.stringContaining('HTTP 403'), 'publishing under "atomic" as set in plugins.home, not confirmed by the server'] });
    n.setWhoami(404); fresh(atomic.ctx);
    expect((await atomic.ctx.fns.plugins.home({})).problems[0]).toContain('does not answer /api/whoami');
});

test('share in the network: publish({ name }) with no address — the repository is created under the Hyper\'s own team, the plugin lands in the shared catalog, another Hyper installs it', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' }), pg = n.hyper('pg', { kind: 'server', tenant: 'pg' }), sched = n.hyper('sched', { kind: 'server', tenant: 'sched' });
    await online(n.server, async () => {
        // Two teams start a plugin of the same name on the same day; neither is published yet.
        sched.use();
        await sched.ctx.fns.plugins.create({ name: 'ehr', description: 'Another EHR.' });
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const ready = await atomic.ctx.fns.plugins.publishReady({ name: 'ehr' });
        expect(ready).toMatchObject({ ready: true, repo: `${SERVER}/git/atomic/plugins/ehr.git`, listing: LISTING });
        expect(ready.checks.filter((c: any) => c.status === 'fail')).toEqual([]);
        expect(ready.checks.find((c: any) => c.id === 'home')!.detail).toBe('server spiffe://hn/atomic/dojo → owner "atomic" on https://git.mesh.test');
        expect(ready.checks.find((c: any) => c.id === 'repository')!.detail).toContain('does not exist yet and will be created');

        // The preview: where, under whom, what the catalog will say — and nothing has changed anywhere.
        const preview = await atomic.ctx.fns.plugins.publish({ name: 'ehr' });
        expect(preview).toMatchObject({
            status: 'preview', repo: `${SERVER}/git/atomic/plugins/ehr.git`, version: '0.1.0', tag: 'v0.1.0', remote: 'missing',
            creates: { repo: 'atomic/plugins/ehr', server: 'git.mesh.test' },
            entry: { name: 'ehr', label: 'Ehr', description: 'Read the EHR.', source: `${SERVER}/git/atomic/plugins/ehr.git`, publishedBy: 'spiffe://hn/atomic/dojo' },
            listing: { status: 'will-add', repo: LISTING },
            home: { server: SERVER, owner: 'atomic', identity: { kind: 'server', id: 'spiffe://hn/atomic/dojo' }, publishedBy: 'spiffe://hn/atomic/dojo', notes: [] },
        });
        expect(n.requests.some(r => r.startsWith('create '))).toBe(false);
        expect(existsSync(join(n.server, 'atomic'))).toBe(false);
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['fhirchat']);

        const done = await atomic.ctx.fns.plugins.publish({ name: 'ehr', confirmed: true, expectedDigest: preview.digest });
        expect(done).toMatchObject({ status: 'published', listing: { status: 'added', repo: LISTING }, at: 'tag' });
        expect(n.requests.filter(r => r.startsWith('create '))).toEqual(['create atomic/plugins/ehr as atomic']);
        expect(git(join(n.server, 'atomic/plugins/ehr.git'), 'rev-parse', 'refs/tags/v0.1.0^{commit}')).toBe(done.commit);
        // The listing: the new entry file, index.json regenerated in file-name order, the other entry untouched, one commit.
        expect(n.index().plugins).toEqual([
            { name: 'ehr', label: 'Ehr', icon: 'ph-puzzle-piece', description: 'Read the EHR.', source: `${SERVER}/git/atomic/plugins/ehr.git`, publishedBy: 'spiffe://hn/atomic/dojo' },
            { name: 'fhirchat', label: 'FHIR Chat', description: 'Search the FHIR chat.', source: `${SERVER}/git/fhir/plugins/fhirchat.git` },
        ]);
        expect(JSON.parse(git(n.listingBare, 'show', 'main:plugins/ehr.json'))).toEqual(n.index().plugins[0]);
        expect(git(n.listingBare, 'log', '--format=%s')).toBe('ehr 0.1.0\nlisting');
        expect(git(n.listingBare, 'show', '--stat', '--format=', 'main').split('\n').map(l => l.trim().split(' ')[0]).filter(f => f?.includes('.'))).toEqual(['index.json', 'plugins/ehr.json']);
        expect((await atomic.lock()).ehr).toMatchObject({ repo: `${SERVER}/git/atomic/plugins/ehr.git`, tag: 'v0.1.0' });

        // Another Hyper of the network sees it in its catalog and installs it — nobody typed an address anywhere.
        pg.use();
        const seen = (await pg.ctx.fns.plugins.catalog({})).plugins.find((p: any) => p.name === 'ehr');
        expect(seen).toMatchObject({ latest: '0.1.0', source: `${SERVER}/git/atomic/plugins/ehr.git`, publishedBy: 'spiffe://hn/atomic/dojo' });
        const plan = await pg.ctx.fns.plugins.install({ name: 'ehr' });
        const inst = await pg.ctx.fns.plugins.install({ name: 'ehr', confirmed: true, expectedDigest: plan.digest });
        expect(inst.status).toBe('applied');
        expect(await readFile(join(pg.user, 'ehr', 'src', 'ehr', 'hello.ts'), 'utf8')).toContain('export default');

        // The team that came second: the catalog already gives the name to atomic — said before anything is pushed,
        // and a new plugin of that name cannot even be started any more.
        sched.use(); fresh(sched.ctx);
        await expect(sched.ctx.fns.plugins.publish({ name: 'ehr' })).rejects.toThrow(`The catalog already lists a plugin named ehr from ${SERVER}/git/atomic/plugins/ehr.git: choose another name`);
        expect((await sched.ctx.fns.plugins.publishReady({ name: 'ehr' })).checks.find((c: any) => c.id === 'name')).toMatchObject({ status: 'fail' });
        expect(existsSync(join(n.server, 'sched'))).toBe(false);
        const late = n.hyper('late', { kind: 'server', tenant: 'late' }); late.use();
        await expect(late.ctx.fns.plugins.create({ name: 'ehr', description: 'A third EHR.' })).rejects.toThrow('A plugin named ehr is already in the catalog');

        // An explicit repo still publishes anywhere, as before, and is not marked with a publisher.
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'notes', description: 'Keep notes.' });
        const elsewhere = await atomic.ctx.fns.plugins.publish({ name: 'notes', repo: `${SERVER}/git/atomic/plugins/notes.git`, createRepo: true });
        expect(elsewhere.home).toBeUndefined();
        expect(elsewhere.entry.publishedBy).toBeUndefined();
        expect(elsewhere.listing).toEqual({ status: 'not-requested' });
    });
}, 120_000);

test('a Hyper that reaches git as a person publishes under the owner of its setting, marked with the person; without the setting it is told what to set', async () => {
    const n = await network();
    const crm = n.hyper('crm', { kind: 'person', email: 'nik@example.test' });
    await online(n.server, async () => {
        crm.use();
        await crm.ctx.fns.plugins.create({ name: 'deals', description: 'Look at deals.' });
        await expect(crm.ctx.fns.plugins.publish({ name: 'deals' })).rejects.toThrow('Give a repository to publish to (repo), or set up this Hyper\'s place in its network: this Hyper reaches https://git.mesh.test as the person nik@example.test');
        crm.ctx.homeSetting = null;
        await expect(crm.ctx.fns.plugins.publish({ name: 'deals' })).rejects.toThrow('plugins.home is not set');
        expect((await crm.ctx.fns.plugins.publishReady({ name: 'deals' })).checks.at(-1)).toMatchObject({ id: 'home', status: 'fail' });
        crm.ctx.homeSetting = { server: SERVER, owner: 'crm' }; fresh(crm.ctx);
        const preview = await crm.ctx.fns.plugins.publish({ name: 'deals' });
        expect(preview).toMatchObject({ repo: `${SERVER}/git/crm/plugins/deals.git`, entry: { publishedBy: 'nik@example.test' }, home: { owner: 'crm', identity: { kind: 'person' }, publishedBy: 'nik@example.test' } });
        // What was reviewed is what gets published: if the server now sees somebody else behind this Hyper, the entry
        // would name another publisher than the one on the review — the old digest confirms nothing.
        crm.ctx.identity = { kind: 'person', email: 'someone-else@example.test' }; fresh(crm.ctx);
        await expect(crm.ctx.fns.plugins.publish({ name: 'deals', confirmed: true, expectedDigest: preview.digest })).rejects.toThrow('Preview digest mismatch: preview again');
        expect(existsSync(join(n.server, 'crm'))).toBe(false);
        crm.ctx.identity = { kind: 'person', email: 'nik@example.test' }; fresh(crm.ctx);
        const done = await crm.ctx.fns.plugins.publish({ name: 'deals', confirmed: true, expectedDigest: preview.digest });
        expect(done.listing.status).toBe('added');
        expect(n.index().plugins.find((p: any) => p.name === 'deals')).toMatchObject({ source: `${SERVER}/git/crm/plugins/deals.git`, publishedBy: 'nik@example.test' });
    });
}, 60_000);

test('two Hypers publish at the same moment: the second fetches and applies its own entry again — both end up listed, nothing is forced', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    await online(n.server, async () => {
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const preview = await atomic.ctx.fns.plugins.publish({ name: 'ehr' });
        // The other publisher: its commit reaches the listing while atomic's push is being received.
        const other = join(n.root, 'other'); git(n.root, 'clone', '-q', n.listingBare, 'other');
        const labs = { name: 'labs', label: 'Labs', description: 'Lab results.', source: `${SERVER}/git/pg/plugins/labs.git` };
        const racer = async (entry: Record<string, unknown>, flag: string) => {
            git(other, 'pull', '-q', 'origin', 'main');
            await writeFile(join(other, 'plugins', `${entry.name}.json`), J(entry));
            const all = []; for (const f of (await readdir(join(other, 'plugins'))).filter(f => f.endsWith('.json')).sort()) all.push(JSON.parse(await readFile(join(other, 'plugins', f), 'utf8')));
            await writeFile(join(other, 'index.json'), J({ format: 2, plugins: all }));
            git(other, 'add', '-A'); git(other, 'commit', '-qm', String(entry.name));
            await writeFile(flag, '');
        };
        const flag = join(n.root, 'race-1');
        await mkdir(join(n.listingBare, 'hooks'), { recursive: true });
        // pre-receive of the listing: while the flag is there, let the other publisher's push in first (a separate
        // receive, outside this push's quarantine). Git then refuses our ref update: the branch is not where we saw it.
        await writeFile(join(n.listingBare, 'hooks', 'pre-receive'), `#!/bin/sh\n[ -n "\${RACE_INNER:-}" ] && exit 0\nfor f in ${n.root}/race-*; do [ -f "$f" ] || continue; rm "$f"; env -i PATH="$PATH" RACE_INNER=1 git -C ${other} push -q ${n.listingBare} HEAD:main || exit 1; break; done\nexit 0\n`);
        await chmod(join(n.listingBare, 'hooks', 'pre-receive'), 0o755);
        await racer(labs, flag);
        const done = await atomic.ctx.fns.plugins.publish({ name: 'ehr', confirmed: true, expectedDigest: preview.digest });
        expect(done.listing.status).toBe('added');
        expect(existsSync(flag)).toBe(false);
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['ehr', 'fhirchat', 'labs']);
        // The other publisher's commit is in the history, ours on top of it: a fast-forward each time.
        expect(git(n.listingBare, 'log', '--format=%s')).toBe('ehr 0.1.0\nlabs\nlisting');

        // listingWrite itself: it says how many pushes it took, and gives up politely when the listing never stops moving.
        const entry = await atomic.ctx.fns.plugins.listingEntryOf({ name: 'ehr', source: `${SERVER}/git/atomic/plugins/ehr.git` });
        const write = (o: Record<string, unknown> = {}) => atomic.ctx.fns.plugins.listingWrite({ listing: LISTING, name: 'ehr', entry: { ...entry, label: 'EHR' }, source: entry.source, message: 'ehr label', ...o });
        await racer({ ...labs, name: 'meds', label: 'Meds', source: `${SERVER}/git/pg/plugins/meds.git` }, join(n.root, 'race-2'));
        expect(await write()).toMatchObject({ status: 'updated', attempts: 2 });
        expect(n.index().plugins.map((p: any) => `${p.name}:${p.label}`)).toEqual(['ehr:EHR', 'fhirchat:FHIR Chat', 'labs:Labs', 'meds:Meds']);
        expect(await write()).toMatchObject({ status: 'unchanged', attempts: 0 });
        // A listing that moves on every attempt: refused after the allowed number, with the reason, and our entry not half-written.
        const before = git(n.listingBare, 'rev-parse', 'main');
        await writeFile(join(n.listingBare, 'hooks', 'pre-receive'), `#!/bin/sh\n[ -n "\${RACE_INNER:-}" ] && exit 0\nenv -i PATH="$PATH" RACE_INNER=1 GIT_AUTHOR_NAME=o GIT_AUTHOR_EMAIL=o@l GIT_COMMITTER_NAME=o GIT_COMMITTER_EMAIL=o@l sh -c 'cd ${other} && git pull -q origin main && git commit -q --allow-empty -m noise && git push -q ${n.listingBare} HEAD:main' || exit 1\nexit 0\n`);
        const busy = await atomic.ctx.fns.plugins.listingWrite({ listing: LISTING, name: 'ehr', entry: { ...entry, label: 'EHR 3' }, source: entry.source, message: 'x', attempts: 2 });
        expect(busy).toMatchObject({ status: 'refused', attempts: 2, detail: 'the listing changed 2 times while publishing: try again' });
        expect(n.index().plugins.find((p: any) => p.name === 'ehr').label).toBe('EHR');
        expect(git(n.listingBare, 'rev-list', '--count', `${before}..main`)).toBe('2');
    });
}, 120_000);

test('the server\'s catalog rule refuses a listing change: said in its own words, not retried, and the published code stays', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    await online(n.server, async () => {
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const preview = await atomic.ctx.fns.plugins.publish({ name: 'ehr' });
        await mkdir(join(n.listingBare, 'hooks'), { recursive: true });
        const counter = join(n.root, 'pushes');
        await writeFile(join(n.listingBare, 'hooks', 'pre-receive'), `#!/bin/sh\necho x >> ${counter}\necho 'catalog guard: plugins/ehr.json: "atomic" may list only its own repository' >&2\nexit 1\n`);
        await chmod(join(n.listingBare, 'hooks', 'pre-receive'), 0o755);
        const done = await atomic.ctx.fns.plugins.publish({ name: 'ehr', confirmed: true, expectedDigest: preview.digest });
        // Published, not listed: a partial result that says what to do next.
        expect(done.status).toBe('published');
        expect(done.listing.status).toBe('push-refused');
        expect(done.listing.detail).toContain('catalog guard: plugins/ehr.json: "atomic" may list only its own repository');
        expect(done.listing.detail).toContain('plugins.addToListing({ name: "ehr" })');
        expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);        // one push, no blind retry
        expect(git(join(n.server, 'atomic/plugins/ehr.git'), 'tag', '--list')).toBe('v0.1.0');
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['fhirchat']);

        // Later, when the listing takes it: register the same release — no new tag, no second publication.
        await rm(join(n.listingBare, 'hooks', 'pre-receive'));
        const add = await atomic.ctx.fns.plugins.addToListing({ name: 'ehr' });
        expect(add).toMatchObject({ status: 'preview', repo: `${SERVER}/git/atomic/plugins/ehr.git`, listing: LISTING, latest: 'v0.1.0', entry: { name: 'ehr', publishedBy: 'spiffe://hn/atomic/dojo' } });
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['fhirchat']);
        await expect(atomic.ctx.fns.plugins.addToListing({ name: 'ehr', confirmed: true, expectedDigest: 'x' })).rejects.toThrow('Preview digest mismatch');
        expect(await atomic.ctx.fns.plugins.addToListing({ name: 'ehr', confirmed: true, expectedDigest: add.digest })).toMatchObject({ status: 'added' });
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['ehr', 'fhirchat']);
        expect(git(join(n.server, 'atomic/plugins/ehr.git'), 'tag', '--list')).toBe('v0.1.0');
        expect(await atomic.ctx.fns.plugins.addToListing({ name: 'ehr', confirmed: true, expectedDigest: add.digest })).toMatchObject({ status: 'unchanged' });
        // Not for a plugin that was never published, and never over another repository's entry of the same name.
        await atomic.ctx.fns.plugins.create({ name: 'draft', description: 'A draft plugin.' });
        await expect(atomic.ctx.fns.plugins.addToListing({ name: 'draft' })).rejects.toThrow('draft is not published yet: publish it first with plugins.publish({ name: "draft" })');
        await expect(atomic.ctx.fns.plugins.listingWrite({ listing: LISTING, name: 'fhirchat', entry: { name: 'fhirchat', label: 'x', description: 'x', source: `${SERVER}/git/atomic/plugins/fhirchat.git` }, source: `${SERVER}/git/atomic/plugins/fhirchat.git`, message: 'takeover' }))
            .rejects.toThrow(`already has a plugin named fhirchat from ${SERVER}/git/fhir/plugins/fhirchat.git`);
    });
}, 120_000);

test('unpublish: the entry leaves the listing; the repository, its tags and installed copies stay; somebody else\'s entry is not removable', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' }), pg = n.hyper('pg', { kind: 'server', tenant: 'pg' });
    await online(n.server, async () => {
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const p = await atomic.ctx.fns.plugins.publish({ name: 'ehr' });
        await atomic.ctx.fns.plugins.publish({ name: 'ehr', confirmed: true, expectedDigest: p.digest });
        pg.use();
        const plan = await pg.ctx.fns.plugins.install({ name: 'ehr' });
        await pg.ctx.fns.plugins.install({ name: 'ehr', confirmed: true, expectedDigest: plan.digest });

        atomic.use();
        const preview = await atomic.ctx.fns.plugins.unpublish({ name: 'ehr' });
        expect(preview).toMatchObject({ status: 'preview', name: 'ehr', repo: `${SERVER}/git/atomic/plugins/ehr.git`, listing: LISTING });
        expect(n.index().plugins.map((x: any) => x.name)).toEqual(['ehr', 'fhirchat']);
        await expect(atomic.ctx.fns.plugins.unpublish({ name: 'ehr', confirmed: true, expectedDigest: 'nope' })).rejects.toThrow('Preview digest mismatch');
        expect(await atomic.ctx.fns.plugins.unpublish({ name: 'ehr', confirmed: true, expectedDigest: preview.digest })).toMatchObject({ status: 'removed' });
        expect(n.index().plugins.map((x: any) => x.name)).toEqual(['fhirchat']);
        expect(git(n.listingBare, 'ls-tree', '--name-only', 'main', 'plugins/').split('\n')).toEqual(['plugins/fhirchat.json']);
        expect(git(n.listingBare, 'log', '-1', '--format=%s')).toBe('remove ehr');
        // What stays: the repository with its release, the author's clone and lock, and pg's installed copy.
        expect(git(join(n.server, 'atomic/plugins/ehr.git'), 'tag', '--list')).toBe('v0.1.0');
        expect((await atomic.lock()).ehr).toMatchObject({ tag: 'v0.1.0' });
        expect(existsSync(join(pg.user, 'ehr', 'package.json'))).toBe(true);
        expect((await pg.lock()).ehr).toMatchObject({ tag: 'v0.1.0' });
        pg.use(); fresh(pg.ctx);
        expect((await pg.ctx.fns.plugins.catalog({})).plugins.map((x: any) => x.name)).toEqual(['fhirchat']);
        // Again: nothing to remove. And it comes back with addToListing.
        atomic.use();
        expect(await atomic.ctx.fns.plugins.unpublish({ name: 'ehr' })).toMatchObject({ status: 'absent' });
        expect(await atomic.ctx.fns.plugins.unpublish({ name: 'ehr', confirmed: true, expectedDigest: preview.digest })).toMatchObject({ status: 'absent' });
        const back = await atomic.ctx.fns.plugins.addToListing({ name: 'ehr' });
        await atomic.ctx.fns.plugins.addToListing({ name: 'ehr', confirmed: true, expectedDigest: back.digest });
        expect(n.index().plugins.map((x: any) => x.name)).toEqual(['ehr', 'fhirchat']);

        // Another team's plugin: not a clone here, and naming a repository of our own does not make the entry ours.
        await expect(atomic.ctx.fns.plugins.unpublish({ name: 'fhirchat' })).rejects.toThrow('fhirchat is not a published clone on this machine: say which repository it is (repo)');
        await expect(atomic.ctx.fns.plugins.unpublish({ name: 'fhirchat', repo: `${SERVER}/git/atomic/plugins/fhirchat.git` })).rejects.toThrow(`already has a plugin named fhirchat from ${SERVER}/git/fhir/plugins/fhirchat.git`);
        expect(n.index().plugins.map((x: any) => x.name)).toEqual(['ehr', 'fhirchat']);
        // With the right repository named it is the same plugin: a plugin can be withdrawn from a Hyper that has no clone of it.
        expect(await atomic.ctx.fns.plugins.unpublish({ name: 'fhirchat', repo: `${SERVER}/git/fhir/plugins/fhirchat.git` })).toMatchObject({ status: 'preview' });
        await expect(atomic.ctx.fns.plugins.unpublish({ name: 'Bad Name' })).rejects.toThrow('Invalid plugin name');
    });
}, 120_000);

test('nothing that looks like a secret is published: keys and tokens in tracked files stop the publication and are never echoed', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    await online(n.server, async () => {
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const dir = join(atomic.user, 'ehr');
        expect(await atomic.ctx.fns.plugins.secretScan({ name: 'ehr' })).toMatchObject({ findings: [] });
        // Assembled at run time so that this test file itself holds nothing a scanner would flag.
        const token = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
        const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
        await writeFile(join(dir, 'src', 'ehr', 'client.ts'), `export const a = 1;\nconst t = "${token}";\n`);
        await writeFile(join(dir, 'key.pem'), `${pem}\nabc\n`);
        await writeFile(join(dir, '.env'), 'PASSWORD=hunter2\n');
        await writeFile(join(dir, '.env.example'), 'PASSWORD=\n');
        await writeFile(join(dir, 'untracked-notes.txt'), `${token}\n`);      // not tracked: not published, not reported
        git(dir, 'add', 'src', 'key.pem', '.env', '.env.example'); git(dir, 'commit', '-qm', 'oops');
        const scan = await atomic.ctx.fns.plugins.secretScan({ name: 'ehr' });
        expect(scan.findings).toEqual([
            { file: '.env', line: 0, kind: 'committed .env file' },
            { file: 'key.pem', line: 1, kind: 'private key' },
            { file: 'src/ehr/client.ts', line: 2, kind: 'GitHub token' },
        ]);
        expect(JSON.stringify(scan)).not.toContain(token);
        git(dir, 'clean', '-fdq');
        let message = '';
        await atomic.ctx.fns.plugins.publish({ name: 'ehr' }).catch((e: Error) => { message = e.message; });
        expect(message).toContain('ehr holds what looks like a secret and is not published: committed .env file in .env; private key in key.pem:1; GitHub token in src/ehr/client.ts:2');
        expect(message).not.toContain(token);
        expect(existsSync(join(n.server, 'atomic'))).toBe(false);
        expect(n.requests.some(r => r.startsWith('create '))).toBe(false);
        const ready = await atomic.ctx.fns.plugins.publishReady({ name: 'ehr' });
        expect(ready.ready).toBe(false);
        expect(ready.checks.find((c: any) => c.id === 'secrets')).toMatchObject({ status: 'fail' });
        expect(JSON.stringify(ready)).not.toContain(token);
        // Removed: it publishes.
        git(dir, 'rm', '-q', 'key.pem', '.env', '.env.example'); await writeFile(join(dir, 'src', 'ehr', 'client.ts'), 'export const a = 1;\n'); git(dir, 'commit', '-qam', 'clean');
        expect((await atomic.ctx.fns.plugins.publish({ name: 'ehr' })).status).toBe('preview');
    });
}, 60_000);

test('publishReady: says what is missing before anything is tried — no folder, a plain folder, uncommitted work, no description, already published', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    await online(n.server, async () => {
        atomic.use();
        const check = async (name = 'ehr') => { const r = await atomic.ctx.fns.plugins.publishReady({ name }); return { ready: r.ready, failed: r.checks.filter((c: any) => c.status === 'fail').map((c: any) => `${c.id}: ${c.detail}`) }; };
        const userPlugins = atomic.ctx.env.USER_PLUGINS;
        atomic.ctx.env.USER_PLUGINS = '';
        expect(await check()).toEqual({ ready: false, failed: ['user-plugins: USER_PLUGINS is not set: this Hyper has no folder for its own plugins'] });
        atomic.ctx.env.USER_PLUGINS = userPlugins;
        await mkdir(join(userPlugins, 'plain', 'src', 'plain'), { recursive: true });
        await writeFile(join(userPlugins, 'plain', 'package.json'), '{"name":"plain","procs":{"src":"src"}}');
        expect((await check('plain')).failed).toEqual(['plugin: plain is a plain folder: put it under git with plugins.gitInit({ name: "plain" })']);
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        expect(await check()).toEqual({ ready: true, failed: [] });
        const dir = join(userPlugins, 'ehr');
        await writeFile(join(dir, 'src', 'ehr', 'more.ts'), 'export default async () => 2;\n');
        expect((await check()).failed).toEqual(['plugin: uncommitted changes: src/ehr/more.ts — commit them first']);
        git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'more');
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); delete pkg.procs.description;
        await writeFile(join(dir, 'package.json'), J(pkg)); git(dir, 'commit', '-qam', 'no description');
        expect((await check()).failed).toEqual(['description: package.json has no procs.description: the catalog needs one sentence about what the plugin does']);
        pkg.procs.description = 'Read the EHR.'; await writeFile(join(dir, 'package.json'), J(pkg)); git(dir, 'commit', '-qam', 'description');
        // The server refuses to say who we are: publishing here cannot work, and the check says why.
        n.setWhoami(403); fresh(atomic.ctx);
        expect((await check()).failed[0]).toContain('home: https://git.mesh.test refused to say who this Hyper is (HTTP 403)');
        n.setWhoami(200); fresh(atomic.ctx);
        // An explicit repository replaces the network checks.
        const explicit = await atomic.ctx.fns.plugins.publishReady({ name: 'ehr', repo: `${SERVER}/git/atomic/plugins/ehr.git` });
        expect(explicit.checks.find((c: any) => c.id === 'repository')).toMatchObject({ status: 'note', detail: expect.stringContaining('publish with createRepo: true') });
        expect(explicit.checks.some((c: any) => c.id === 'home')).toBe(false);
        // Published: there is nothing to publish again.
        const p = await atomic.ctx.fns.plugins.publish({ name: 'ehr' });
        await atomic.ctx.fns.plugins.publish({ name: 'ehr', confirmed: true, expectedDigest: p.digest });
        expect((await check()).failed[0]).toContain('plugin: ehr is already published');
        // It changes nothing: the checks ran several times and the server holds one repository, one tag, one listing commit.
        expect(git(join(n.server, 'atomic/plugins/ehr.git'), 'tag', '--list')).toBe('v0.1.0');
        expect(git(n.listingBare, 'rev-list', '--count', 'main')).toBe('2');
    });
}, 120_000);

test('the plugin page: a local plugin gets "Share in the network" — a review first, the digest with the confirmation; without a place in the network there is no button', async () => {
    const n = await network();
    const atomic = n.hyper('atomic', { kind: 'server', tenant: 'atomic' });
    await online(n.server, async () => {
        atomic.use();
        await atomic.ctx.fns.plugins.create({ name: 'ehr', description: 'Read the EHR.' });
        const page = () => atomic.ctx.fns.plugins.clonePanel({ name: 'ehr', req: new Request('http://h/plugins/ehr') });
        const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => route(atomic.ctx, null, {
            req: new Request('http://h/plugins/ehr/git', { method: 'POST', body: new URLSearchParams(fields).toString(), headers: { origin: 'http://h', 'content-type': 'application/x-www-form-urlencoded', ...headers } }),
            params: { name: 'ehr' },
        }) as Promise<any>;
        // The button is drawn from the setting alone: rendering the page asks the network nothing.
        const asked = n.requests.length;
        let html = await page();
        expect(html).toContain('data-git-action="share"');
        expect(html).toContain('Share in the network');
        expect(n.requests.length).toBe(asked);
        // No place in the network: the old hint, no button. Uncommitted work: no button either.
        atomic.ctx.homeSetting = null;
        html = await page();
        expect(html).not.toContain('data-git-action="share"');
        expect(html).toContain('plugins.publish({ name, repo })');
        atomic.ctx.homeSetting = SERVER;
        await writeFile(join(atomic.user, 'ehr', 'src', 'ehr', 'wip.ts'), 'export default async () => 1;\n');
        expect(await page()).not.toContain('data-git-action="share"');
        await rm(join(atomic.user, 'ehr', 'src', 'ehr', 'wip.ts'));

        // The form is same-origin, CSRF-protected, and takes nothing but its known fields.
        expect((await post({ _csrf: 'tok', operation: 'share' }, { origin: 'http://evil' })).status).toBe(403);
        expect((await post({ _csrf: 'bad', operation: 'share' })).status).toBe(403);
        expect((await post({ _csrf: 'tok', operation: 'share', repo: 'https://evil.test/x.git' })).status).toBe(400);
        expect((await post({ _csrf: 'tok', operation: 'share', confirmed: 'true', digest: 'short' })).status).toBe(400);

        // First post: the review. Nothing is created or pushed.
        let r = await post({ _csrf: 'tok', operation: 'share' });
        expect(r.main).toContain('data-share-review');
        expect(r.main).toContain('Publishes this plugin inside the network of this Hyper');
        expect(r.main).toContain(`<dt>Repository</dt><dd>${SERVER}/git/atomic/plugins/ehr.git (will be created)</dd>`);
        expect(r.main).toContain('<dt>Owner</dt><dd>atomic</dd>');
        expect(r.main).toContain('<dt>Published by</dt><dd>spiffe://hn/atomic/dojo</dd>');
        expect(r.main).toContain('<dt>Version</dt><dd>v0.1.0');
        expect(r.main).toContain(`<dt>Catalog</dt><dd>${LISTING}: adds &quot;Ehr&quot; — Read the EHR.</dd>`);
        expect(r.main).toContain('<dt>Tests</dt><dd>passed</dd>');
        const digest = /name="digest" value="([0-9a-f]{64})"/.exec(r.main)?.[1];
        expect(digest).toBeDefined();
        expect(r.main).toContain('name="confirmed" value="true"');
        expect(existsSync(join(n.server, 'atomic'))).toBe(false);
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['fhirchat']);

        // The plugin changed after the review: the old digest no longer confirms anything.
        await writeFile(join(atomic.user, 'ehr', 'src', 'ehr', 'more.ts'), 'export default async () => 2;\n');
        git(join(atomic.user, 'ehr'), 'add', '-A'); git(join(atomic.user, 'ehr'), 'commit', '-qm', 'more');
        r = await post({ _csrf: 'tok', operation: 'share', confirmed: 'true', digest: digest! });
        expect(r.main).toContain('Preview digest mismatch: preview again');
        expect(existsSync(join(n.server, 'atomic'))).toBe(false);

        // Review again, confirm: published and in the catalog; the panel now shows a published clone.
        r = await post({ _csrf: 'tok', operation: 'share' });
        const digest2 = /name="digest" value="([0-9a-f]{64})"/.exec(r.main)![1]!;
        expect(digest2).not.toBe(digest);
        r = await post({ _csrf: 'tok', operation: 'share', confirmed: 'true', digest: digest2 });
        expect(r.main).toContain(`Published v0.1.0 to ${SERVER}/git/atomic/plugins/ehr.git. It is in the network catalog: other Hypers see it within a minute.`);
        expect(n.index().plugins.map((p: any) => p.name)).toEqual(['ehr', 'fhirchat']);
        html = await page();
        expect(html).not.toContain('data-git-action="share"');
        expect(html).toContain(`<code>${SERVER}/git/atomic/plugins/ehr.git</code>`);
        // Sharing what is already shared is an error message on the page, not a second publication.
        r = await post({ _csrf: 'tok', operation: 'share' });
        expect(r.main).toContain('already has an origin');
        expect(git(n.listingBare, 'rev-list', '--count', 'main')).toBe('2');
    });
}, 120_000);
