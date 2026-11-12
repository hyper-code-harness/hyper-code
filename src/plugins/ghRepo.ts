/**
 * Looks up a GitHub repository with gh and, when asked, creates it — the optional GitHub step of publishing a plugin
 *
 * Use from plugins.publish when the plugin's home is GitHub and the repository may not exist yet. Without `create` it only looks: `exists`, `visibility` and whether this account can push. With `create: true` it creates the missing repository (private unless visibility says public) with `gh repo create` and returns it; an existing repository is never changed. Needs a logged-in gh. A lookup that fails for another reason than "not found" (no login, no network) throws instead of being taken for a free name. Other git servers have no such step: create the repository there yourself and pass its address to plugins.publish.
 * @param opts.repo Repository as owner/repo.
 * @param opts.create Create the repository when it does not exist. @default false
 * @param opts.visibility Visibility of a repository created here. @default private
 * @param opts.description Description of a repository created here.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Repository as owner/repo. */
        repo: string;
        /** Create the repository when it does not exist. @default false */
        create?: boolean;
        /** Visibility of a repository created here. @default private */
        visibility?: 'public' | 'private';
        /** Description of a repository created here. */
        description?: string;
    },
): Promise<{ exists: boolean; created: boolean; url: string; visibility?: 'public' | 'private'; canPush?: boolean }> {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(opts.repo ?? ''))) throw new Error('Repository must be owner/repo');
    const gh = async (args: string[]) => {
        const p = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
        const timer = setTimeout(() => p.kill(), 60_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        return { ok: code === 0, out: out.trim(), err: err.trim() };
    };
    const url = `https://github.com/${opts.repo}.git`;
    const seen = await gh(['api', `repos/${opts.repo}`, '--jq', '{private: .private, push: .permissions.push}']);
    if (seen.ok) {
        const info = JSON.parse(seen.out || '{}');
        return { exists: true, created: false, url, visibility: info.private ? 'private' as const : 'public' as const, canPush: info.push === true };
    }
    // Anything but "not found" is a real problem (no login, network): do not mistake it for a free name.
    if (!/HTTP 404|Not Found/i.test(seen.err)) throw new Error(`gh could not look up ${opts.repo}: ${(seen.err.split('\n').at(-1) ?? '').slice(0, 300)}`);
    if (!opts.create) return { exists: false, created: false, url };
    const visibility = opts.visibility === 'public' ? 'public' : 'private';
    const made = await gh(['repo', 'create', opts.repo, `--${visibility}`, ...(opts.description ? ['--description', String(opts.description).slice(0, 300)] : [])]);
    if (!made.ok) throw new Error(`gh could not create ${opts.repo}: ${(made.err.split('\n').at(-1) ?? '').slice(0, 300)}`);
    return { exists: true, created: true, url, visibility, canPush: true };
}
