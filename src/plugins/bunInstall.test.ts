import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bunInstall from './bunInstall';
import inspectPackage from './inspectPackage';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@l', ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}

/** A git repository holding one plugin, tagged v1 and v2, and an empty host. */
async function fixture(namespace = 'demo') {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bun-install-')));
    roots.push(root);
    const repo = join(root, 'repo');
    await mkdir(join(repo, 'src', namespace), { recursive: true });
    const write = async (version: string, body: string) => {
        await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'demo', version, type: 'module', procs: { src: 'src' } }));
        await writeFile(join(repo, 'SKILL.md'), 'Demo plugin');
        await writeFile(join(repo, 'src', namespace, 'hello.ts'), `export default async () => ${JSON.stringify(body)};`);
    };
    await write('1.0.0', 'v1');
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'v1'); git(repo, 'tag', 'v1');
    await write('2.0.0', 'v2');
    await writeFile(join(repo, 'NOTES.md'), 'new file');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'v2'); git(repo, 'tag', 'v2');
    const host = join(root, 'host');
    let reloads = 0;
    const ctx: any = {
        env: { PLUGIN_HOST: host, HOME: root },
        state: { procs: { modules: [{ name: 'core', dir: '/core/src', namespaces: ['agent', 'plugins'] }] } },
        fns: { plugins: {}, procs: { modules: { reload: async () => { reloads++; } } } },
    };
    ctx.fns.plugins.inspectPackage = (o: any) => inspectPackage(ctx, null, o);
    const call = (o: any) => bunInstall(ctx, null, o);
    const spec = (tag: string) => `git+file://${repo}#${tag}`;
    const hello = async () => (await import(join(host, 'node_modules/demo/src', namespace, 'hello.ts') + '?t=' + Math.random())).default();
    return { root, repo, host, ctx, call, spec, hello, reloads: () => reloads };
}

test('install previews in a copy, confirms by digest, then update, rollback and remove', async () => {
    const f = await fixture();
    const preview = await f.call({ operation: 'install', spec: f.spec('v1') });
    expect(preview).toMatchObject({ status: 'preview', name: 'demo', plugin: { namespaces: ['demo'], version: '1.0.0' } });
    expect(preview.added).toEqual(['SKILL.md', 'package.json', 'src/demo/hello.ts']);
    expect(preview.resolved).toContain('demo@git+file://');
    expect(await readdir(join(f.host, 'node_modules')).catch(() => [])).toEqual([]);
    await expect(f.call({ operation: 'install', spec: f.spec('v1'), confirmed: true, expectedDigest: 'x' })).rejects.toThrow('digest');
    const applied = await f.call({ operation: 'install', spec: f.spec('v1'), confirmed: true, expectedDigest: preview.digest });
    expect(applied.status).toBe('applied');
    expect(f.reloads()).toBe(1);
    expect(await f.hello()).toBe('v1');
    await expect(f.call({ operation: 'install', spec: f.spec('v2') })).rejects.toThrow('already installed');

    const update = await f.call({ operation: 'update', spec: f.spec('v2') });
    expect(update.added).toEqual(['NOTES.md']);
    expect(update.changed).toEqual(['package.json', 'src/demo/hello.ts']);
    expect(await f.hello()).toBe('v1');
    await f.call({ operation: 'update', spec: f.spec('v2'), confirmed: true, expectedDigest: update.digest });
    expect(await f.hello()).toBe('v2');

    const rollback = await f.call({ operation: 'rollback' });
    expect(rollback.removed).toEqual(['NOTES.md']);
    await f.call({ operation: 'rollback', confirmed: true, expectedDigest: rollback.digest });
    expect(await f.hello()).toBe('v1');
    expect(JSON.parse(await readFile(join(f.host, 'package.json'), 'utf8')).dependencies.demo).toBe(f.spec('v1'));

    const remove = await f.call({ operation: 'remove', name: 'demo' });
    expect(remove.removed).toContain('src/demo/hello.ts');
    await f.call({ operation: 'remove', name: 'demo', confirmed: true, expectedDigest: remove.digest });
    expect(JSON.parse(await readFile(join(f.host, 'package.json'), 'utf8')).dependencies ?? {}).toEqual({});
});

test('a namespace owned by another module is refused before anything changes', async () => {
    const f = await fixture('agent');
    await expect(f.call({ operation: 'install', spec: f.spec('v1') })).rejects.toThrow('Namespace collision: agent is provided by core');
    expect(JSON.parse(await readFile(join(f.host, 'package.json'), 'utf8')).dependencies).toBeUndefined();
});

test('package scripts are refused and never run', async () => {
    const f = await fixture();
    const marker = join(f.root, 'ran');
    await writeFile(join(f.repo, 'package.json'), JSON.stringify({ name: 'demo', version: '3.0.0', procs: { src: 'src' }, scripts: { prepare: `touch ${marker}`, postinstall: `touch ${marker}` } }));
    git(f.repo, 'commit', '-qam', 'v3'); git(f.repo, 'tag', 'v3');
    await expect(f.call({ operation: 'install', spec: f.spec('v3') })).rejects.toThrow('scripts');
    expect(await readFile(marker).then(() => true, () => false)).toBe(false);
});

test('a second operation is refused while one holds the host lock; unknown remove is refused', async () => {
    const f = await fixture();
    await f.call({ operation: 'install', spec: f.spec('v1') });
    await mkdir(join(f.host, '.operation-lock'));
    await expect(f.call({ operation: 'install', spec: f.spec('v1') })).rejects.toThrow('Another plugin operation');
    await rm(join(f.host, '.operation-lock'), { recursive: true });
    await expect(f.call({ operation: 'remove', name: 'demo' })).rejects.toThrow('not installed');
    await expect(f.call({ operation: 'rollback' })).rejects.toThrow('Nothing to roll back');
});

test('inspectPackage allows dependencies, skips node_modules and .bun-tag, refuses links and scopes', async () => {
    const f = await fixture();
    const dir = join(f.root, 'pkg');
    await mkdir(join(dir, 'src', 'x'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'lib'), { recursive: true });
    await writeFile(join(dir, 'src', 'x', 'a.ts'), 'export default 1');
    await writeFile(join(dir, '.bun-tag'), 'abc');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg', procs: {}, dependencies: { vega: '^6' } }));
    const r = await inspectPackage(f.ctx, null, { dir });
    expect(r).toMatchObject({ name: 'pkg', src: 'src', namespaces: ['x'], files: ['package.json', 'src/x/a.ts'], dependencies: { vega: '^6' } });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@s/pkg', procs: {} }));
    await expect(inspectPackage(f.ctx, null, { dir })).rejects.toThrow('unscoped');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg', procs: { src: '../up' } }));
    await expect(inspectPackage(f.ctx, null, { dir })).rejects.toThrow('procs.src');
});

test('procs.requires: a missing plugin blocks install, a required one cannot be removed', async () => {
    const f = await fixture();
    const user = join(f.root, 'user');
    await mkdir(join(user, 'src', 'user'), { recursive: true });
    await writeFile(join(user, 'src', 'user', 'hi.ts'), 'export default async () => 1;');
    await writeFile(join(user, 'package.json'), JSON.stringify({ name: 'user', version: '1.0.0', procs: { requires: ['demo'] }, scripts: { test: 'bun test' } }));
    git(user, 'init', '-q'); git(user, 'add', '-A'); git(user, 'commit', '-qm', 'u'); git(user, 'tag', 'v1');
    const userSpec = `git+file://${user}#v1`;
    await expect(f.call({ operation: 'install', spec: userSpec })).rejects.toThrow('user requires demo: install it first');
    const demo = await f.call({ operation: 'install', spec: f.spec('v1') });
    await f.call({ operation: 'install', spec: f.spec('v1'), confirmed: true, expectedDigest: demo.digest });
    const ok = await f.call({ operation: 'install', spec: userSpec });
    expect(ok.plugin?.requires).toEqual(['demo']);
    await f.call({ operation: 'install', spec: userSpec, confirmed: true, expectedDigest: ok.digest });
    await expect(f.call({ operation: 'remove', name: 'demo' })).rejects.toThrow('demo is required by user: remove it first');
});
