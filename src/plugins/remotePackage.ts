/**
 * Reads package.json of a plugin repository at a tag, branch or commit on any git server, without cloning its history
 *
 * Use before installing to learn what a release declares — its name, version and procs.requires — when the repository is not cloned yet. Fetches exactly one commit (`git fetch --depth 1`) into a throwaway folder and reads the file with `git show`, so it works the same for GitHub, GitLab, Gitea, a company server and a local repository, and uses whatever git access this machine already has (credential helper, ssh key). Returns the commit the ref points at and the parsed package.json, or `package: null` when the file is missing or not a JSON object. Throws when the ref cannot be fetched. Nothing is installed or kept on disk.
 * @param opts.repo Repository address, as plugins.repoUrl accepts it.
 * @param opts.ref What to read: refs/tags/<tag>, refs/heads/<branch> or a full 40-character commit SHA.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Repository address, as plugins.repoUrl accepts it. */
        repo: string;
        /** What to read: refs/tags/<tag>, refs/heads/<branch> or a full 40-character commit SHA. */
        ref: string;
    },
): Promise<{ commit: string; package: Record<string, any> | null }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { url } = await ctx.fns.plugins.repoUrl({ repo: opts.repo });
    const ref = String(opts.ref ?? '');
    if (!/^(refs\/(tags|heads)\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,150}|[0-9a-f]{40})$/.test(ref) || ref.includes('..'))
        throw new Error('Ref must be refs/tags/<tag>, refs/heads/<branch> or a full commit SHA');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-plugin-ref-'));
    const git = async (args: string[]) => {
        const p = Bun.spawn(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        const timer = setTimeout(() => p.kill(), 60_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        return { ok: code === 0, out: out.trim(), err: (err.trim().split('\n').at(-1) ?? String(code)).slice(0, 300) };
    };
    try {
        await git(['init', '-q']);
        // One commit, no history: enough to read a file, and it works the same on any git server.
        const fetched = await git(['fetch', '-q', '--depth', '1', '--no-tags', url, ref]);
        if (!fetched.ok) throw new Error(`Could not read ${ref} of ${opts.repo}: ${fetched.err}`);
        const commit = (await git(['rev-parse', 'FETCH_HEAD^{commit}'])).out;
        const file = await git(['show', 'FETCH_HEAD:package.json']);
        let pkg: Record<string, any> | null = null;
        if (file.ok) { try { const v = JSON.parse(file.out); if (v && typeof v === 'object' && !Array.isArray(v)) pkg = v; } catch { pkg = null; } }
        return { commit, package: pkg };
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
