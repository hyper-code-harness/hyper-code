import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import validateTree from './validateTree';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'validate-tree-'));
    roots.push(dir);
    await mkdir(join(dir, 'src', 'example'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'example', procs: { src: 'src' } }));
    await writeFile(join(dir, 'SKILL.md'), 'Example plugin');
    await writeFile(join(dir, 'src', 'example', 'hello.ts'), 'export default () => "hello";');
    return { dir, call: () => validateTree({} as any, null, { dir }) };
}

test('digest is deterministic, content-only and ignores the installation lock', async () => {
    const f = await fixture();
    const a = await f.call();
    expect(a).toMatchObject({ name: 'example', src: 'src' });
    expect(a.files).toEqual(['SKILL.md', 'package.json', 'src/example/hello.ts']);
    expect((await f.call()).digest).toBe(a.digest);
    await writeFile(join(f.dir, '.plugin-lock.json'), '{}');
    expect((await f.call()).digest).toBe(a.digest);
    await writeFile(join(f.dir, 'SKILL.md'), 'changed');
    expect((await f.call()).digest).not.toBe(a.digest);
});

test('rejects symlinks, scripts, dependencies, unsafe src, host manifests and embedded repositories', async () => {
    const f = await fixture();
    await symlink('/etc/passwd', join(f.dir, 'link'));
    await expect(f.call()).rejects.toThrow('regular');
    await rm(join(f.dir, 'link'));
    for (const patch of [{ scripts: { install: 'bad' } }, { dependencies: { bad: '*' } }, { procs: { src: '../escape' } }, { procs: { modules: {} } }, { name: '@scope/x' }]) {
        await writeFile(join(f.dir, 'package.json'), JSON.stringify({ name: 'example', procs: { src: 'src' }, ...patch }));
        await expect(f.call()).rejects.toThrow();
    }
    await writeFile(join(f.dir, 'package.json'), JSON.stringify({ name: 'example', procs: { src: 'src' } }));
    await mkdir(join(f.dir, '.git'));
    await expect(f.call()).rejects.toThrow('Embedded repository');
    await rm(join(f.dir, '.git'), { recursive: true });
    await writeFile(join(f.dir, '.env'), 'SECRET=1');
    await expect(f.call()).rejects.toThrow('credential');
});
