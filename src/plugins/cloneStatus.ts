/**
 * Reports the git state of a plugin clone: commit, tag, branch, uncommitted files, unpushed commits, ahead/behind and remotes
 *
 * Use before changing a clone (update, rollback and remove refuse or ask for force when it has local work) and to
 * show its status. Offline: compares with the remote-tracking refs as last fetched. `unpushed` lists commits of
 * HEAD that are on no remote branch and under no tag; `dirty` ignores node_modules, which the installer keeps out
 * of git — bun.lock is the author's file and counts. ahead/behind count HEAD against the upstream of the current branch, or against the
 * checked-out tag when detached.
 * @param opts.dir Absolute directory of the clone.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Absolute directory of the clone. */
    dir: string;
}): Promise<{
    git: boolean;
    commit?: string;
    /** vX.Y.Z tag pointing at HEAD, if any. */
    tag?: string;
    /** Current branch; absent when HEAD is detached. */
    branch?: string;
    /** Nearest vX.Y.Z tag reachable from HEAD. */
    baseTag?: string;
    /** Commits since baseTag (0 when HEAD is at it). */
    sinceTag: number;
    dirty: string[];
    unpushed: string[];
    ahead: number;
    behind: number;
    origin?: string;
    upstream?: string;
}> {
    const run = (...args: string[]) => {
        const p = Bun.spawnSync(['git', ...args], { cwd: opts.dir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        return { ok: p.exitCode === 0, out: p.stdout.toString().replace(/\s+$/, '').replace(/^\n+/, '') };
    };
    if (!run('rev-parse', '--is-inside-work-tree').ok || run('rev-parse', '--show-toplevel').out !== (await import('node:fs')).realpathSync(opts.dir))
        return { git: false, sinceTag: 0, dirty: [], unpushed: [], ahead: 0, behind: 0 };
    const lines = (s: string) => s.split('\n').filter(Boolean);
    const commit = run('rev-parse', 'HEAD').out.trim();
    const tag = lines(run('tag', '--points-at', 'HEAD', '--list', 'v*').out).filter(t => /^v\d+\.\d+\.\d+$/.test(t)).sort().at(-1);
    const branch = run('symbolic-ref', '-q', '--short', 'HEAD');
    const baseTag = run('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', 'HEAD');
    const dirty = lines(run('status', '--porcelain', '--untracked-files=all').out)
        .map(l => l.slice(3)).filter(p => !p.startsWith('node_modules'));
    const unpushed = lines(run('log', '--format=%h %s', 'HEAD', '--not', '--remotes', '--tags').out);
    let ahead = 0, behind = 0;
    const against = branch.ok ? run('rev-parse', '--abbrev-ref', '@{upstream}') : { ok: !!baseTag.ok, out: baseTag.out };
    if (against.ok && against.out) {
        const counts = run('rev-list', '--left-right', '--count', `HEAD...${against.out}`).out.split(/\s+/).map(Number);
        ahead = counts[0] || 0; behind = counts[1] || 0;
    }
    const sinceTag = baseTag.ok && baseTag.out ? Number(run('rev-list', '--count', `${baseTag.out}..HEAD`).out) || 0 : 0;
    const remote = (n: string) => { const r = run('remote', 'get-url', n); return r.ok && r.out ? r.out : undefined; };
    const origin = remote('origin'), upstream = remote('upstream');
    return {
        git: true, commit,
        ...(tag ? { tag } : {}),
        ...(branch.ok && branch.out ? { branch: branch.out } : {}),
        ...(baseTag.ok && baseTag.out ? { baseTag: baseTag.out } : {}),
        sinceTag, dirty, unpushed, ahead, behind,
        ...(origin ? { origin } : {}),
        ...(upstream ? { upstream } : {}),
    };
}
