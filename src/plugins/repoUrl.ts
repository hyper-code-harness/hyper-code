/**
 * Parses a plugin repository address on any git server into the URL git uses, the form stored in listings and the lock, and a key for comparing two addresses
 *
 * Use wherever a plugin repository is named — a listing entry, the plugin lock, a clone's origin — so GitHub, GitLab, Gitea, a company server and a repository on this machine are all handled by one rule. Accepts `github:owner/repo`, `https://host/path`, `ssh://git@host/path`, `git@host:path`, `file:///path`, an absolute path, and the same with a `git+` prefix. Returns `url` (what is passed to git), `source` (the canonical spelling: `github:owner/repo` for GitHub over https, `git+file:///path` for a local repository, otherwise the address as given), `key` (host and path, lowercased, without `.git` — equal for two spellings of one repository), `kind`, and `github` (`owner/repo`) when the host is github.com. It only parses: nothing is contacted. Refuses whitespace, a leading dash, `..` segments and https addresses that carry a user or password, because the address is shown on pages and written to the lock file.
 * @param opts.repo Repository address: github:owner/repo, https://host/path, ssh://git@host/path, git@host:path, file:///path or an absolute path.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Repository address: github:owner/repo, https://host/path, ssh://git@host/path, git@host:path, file:///path or an absolute path. */
        repo: string;
    },
): Promise<{ kind: 'github' | 'https' | 'ssh' | 'file'; url: string; source: string; key: string; host?: string; github?: string; local?: string }> {
    const raw = String(opts.repo ?? '').trim();
    const bad = () => new Error(`Unsupported plugin repository: ${raw.slice(0, 200) || '(empty)'} — use github:owner/repo, https://host/path, ssh://git@host/path, git@host:path or file:///path`);
    // Whitespace, control characters and a leading dash never reach git: the address is passed to it as an argument.
    if (!raw || raw.length > 500 || /[\s\x00-\x1f\x7f]/.test(raw) || raw.startsWith('-')) throw bad();
    const HOST = '[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?';
    const PATH = '[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*';
    const tidy = (p: string) => p.replace(/\/+$/, '').replace(/\.git$/, '');
    const remote = (kind: 'https' | 'ssh', url: string, host: string, p: string) => {
        const path = tidy(p);
        if (!path || path.split('/').some(s => s === '.' || s === '..')) throw bad();
        const h = host.toLowerCase().replace(/:\d+$/, '');
        // GitHub by any spelling is one repository: the short form is what a listing and the lock show.
        const github = h === 'github.com' && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(path) ? path : undefined;
        return {
            kind: github && kind === 'https' ? 'github' as const : kind,
            url: github && kind === 'https' ? `https://github.com/${github}.git` : url,
            source: github && kind === 'https' ? `github:${github}` : url,
            key: `${h}/${path}`.toLowerCase(),
            host: h,
            ...(github ? { github } : {}),
        };
    };
    let m: RegExpExecArray | null;
    if ((m = /^github:([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/.exec(raw))) return remote('https', '', 'github.com', m[1]!);
    // `git+` is the package-manager spelling of the same address.
    const s = raw.replace(/^git\+/, '');
    // https: no user or password in the address — it would end up in the lock file and on pages.
    if ((m = new RegExp(`^https://(${HOST}(?::\\d{1,5})?)/(${PATH})/?$`).exec(s))) return remote('https', s, m[1]!, m[2]!);
    if ((m = new RegExp(`^ssh://(?:[A-Za-z0-9._-]+@)?(${HOST})(?::\\d{1,5})?/(${PATH})/?$`).exec(s))) return remote('ssh', s, m[1]!, m[2]!);
    // scp-like: git@host:group/repo.git
    if ((m = new RegExp(`^[A-Za-z0-9._-]+@(${HOST}):(${PATH})/?$`).exec(s))) return remote('ssh', s, m[1]!, m[2]!);
    // A repository on this machine: file:///abs or an absolute path.
    const local = s.startsWith('file:///') ? s.slice(7) : s.startsWith('/') ? s : '';
    if (local && !local.split('/').some(seg => seg === '..')) {
        const url = s.startsWith('file:///') ? s : local;
        return { kind: 'file' as const, url, source: `git+file://${local}`, key: tidy(local).toLowerCase(), local };
    }
    throw bad();
}
