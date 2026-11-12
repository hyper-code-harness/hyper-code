import { test, expect } from 'bun:test';
import repoUrl from './repoUrl';

const parse = (repo: string) => repoUrl({} as any, null, { repo });

test('GitHub in any spelling is one repository: the same key, the short form as source', async () => {
    const short = await parse('github:hyper-code-harness/mermaid');
    expect(short).toEqual({ kind: 'github', url: 'https://github.com/hyper-code-harness/mermaid.git', source: 'github:hyper-code-harness/mermaid', key: 'github.com/hyper-code-harness/mermaid', host: 'github.com', github: 'hyper-code-harness/mermaid' });
    for (const spelling of ['https://github.com/hyper-code-harness/mermaid', 'https://github.com/hyper-code-harness/mermaid.git', 'https://GitHub.com/Hyper-Code-Harness/Mermaid.git/', 'git+https://github.com/hyper-code-harness/mermaid.git']) {
        const r = await parse(spelling);
        expect([spelling, r.key, r.kind]).toEqual([spelling, 'github.com/hyper-code-harness/mermaid', 'github']);
    }
    // Over ssh it is still that repository (same key), but git must use the ssh address as given.
    const ssh = await parse('git@github.com:hyper-code-harness/mermaid.git');
    expect(ssh).toMatchObject({ kind: 'ssh', url: 'git@github.com:hyper-code-harness/mermaid.git', source: 'git@github.com:hyper-code-harness/mermaid.git', key: short.key, github: 'hyper-code-harness/mermaid' });
});

test('other git servers: https, ssh and scp-like addresses keep their address and get a comparable key', async () => {
    expect(await parse('https://gitlab.com/group/sub/plugin.git')).toEqual({ kind: 'https', url: 'https://gitlab.com/group/sub/plugin.git', source: 'https://gitlab.com/group/sub/plugin.git', key: 'gitlab.com/group/sub/plugin', host: 'gitlab.com' });
    expect((await parse('https://git.company.example:8443/team/plugin')).key).toBe('git.company.example/team/plugin');
    expect(await parse('ssh://git@git.company.example:2222/team/plugin.git')).toMatchObject({ kind: 'ssh', url: 'ssh://git@git.company.example:2222/team/plugin.git', key: 'git.company.example/team/plugin' });
    expect(await parse('git@gitlab.com:group/plugin.git')).toMatchObject({ kind: 'ssh', key: 'gitlab.com/group/plugin' });
    // The https and the ssh address of one repository compare equal.
    expect((await parse('https://gitlab.com/group/plugin')).key).toBe((await parse('git@gitlab.com:group/plugin.git')).key);
    expect((await parse('https://gitlab.com/group/plugin')).github).toBeUndefined();
    // Whitespace around a pasted address is dropped; inside it is refused (see below).
    expect((await parse('  https://gitlab.com/group/plugin\n')).url).toBe('https://gitlab.com/group/plugin');
});

test('a repository on this machine: file URL, git+file and an absolute path', async () => {
    expect(await parse('git+file:///srv/git/plugin.git')).toEqual({ kind: 'file', url: 'file:///srv/git/plugin.git', source: 'git+file:///srv/git/plugin.git', key: '/srv/git/plugin', local: '/srv/git/plugin.git' });
    expect(await parse('/srv/git/plugin')).toMatchObject({ kind: 'file', url: '/srv/git/plugin', source: 'git+file:///srv/git/plugin' });
    expect((await parse('file:///srv/git/plugin')).key).toBe((await parse('/srv/git/plugin.git')).key);
});

test('refused: credentials in the address, option-like and malformed addresses, other schemes', async () => {
    for (const bad of [
        '', ' ', 'npm:x', 'http://example.org/x', 'https://user:secret@example.org/x', 'https://token@example.org/x', 'https://example.org',
        'https://example.org/a/../b', '--upload-pack=touch /tmp/x', '-oProxyCommand=x', '-o@host.example:team/x', 'git@host:../x', 'ext::sh -c x', 'https://example.org/x y',
        'https://example.org/x\ny', 'github:only-owner', '/srv/../etc', 'relative/path', 'x'.repeat(501),
    ])
        await expect(parse(bad)).rejects.toThrow('Unsupported plugin repository');
});
