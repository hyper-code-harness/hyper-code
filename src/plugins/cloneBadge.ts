/**
 * Turns a plugin clone's git state into its short status badges: the ref (release, branch, commit), new upstream commits, edited, fork
 *
 * Use wherever an installed plugin is shown (catalog card, plugin page) so the words are the same everywhere.
 * `v1.0.1` — clean at a release tag; `main · abc1234` — branch mode, following that branch at that commit;
 * `abc1234` — pinned to a commit; `+3 new` — the followed branch moved upstream (git.newCommits) and Update will
 * show them; `main +3` — on a branch (or detached) that many commits past its last release tag, e.g. after
 * plugins.edit; `edited` — uncommitted files or commits on no remote; `fork` — origin is not the repository it was
 * installed from. `local` — a private plugin in a git repository without a remote (git.local): the only ref badge
 * it gets, and `edited` then means uncommitted files only, since nothing of it can be pushed. Returns them in that
 * order; a clean clone at its tag has exactly one.
 * @param opts.git Clone state from plugins.installed (`git`).
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Clone state from plugins.installed (`git`). */
    git: types.plugins.CloneGit;
}): Array<{ label: string; kind: 'release' | 'branch' | 'commit' | 'new' | 'edited' | 'ahead' | 'fork' | 'local' }> {
    const g = opts.git;
    const out: Array<{ label: string; kind: 'release' | 'branch' | 'commit' | 'new' | 'edited' | 'ahead' | 'fork' | 'local' }> = [];
    const short = g.commit.slice(0, 7);
    if (g.local) out.push({ label: 'local', kind: 'local' });
    else if (g.mode === 'branch' && g.branch && g.branch === g.lockedBranch) out.push({ label: `${g.branch} · ${short}`, kind: 'branch' });
    else if (g.mode === 'commit' && !g.branch) out.push({ label: short, kind: 'commit' });
    else if (g.tag && !g.branch) out.push({ label: g.tag, kind: 'release' });
    else if (g.sinceTag > 0 || g.branch) out.push({ label: `${g.branch ?? 'detached'}${g.sinceTag > 0 ? ' +' + g.sinceTag : ''}`, kind: 'ahead' });
    else out.push({ label: g.baseTag ?? short, kind: 'release' });
    if (g.mode === 'branch' && (g.newCommits ?? 0) > 0) out.push({ label: `+${g.newCommits} new`, kind: 'new' });
    if (g.dirty.length || (!g.local && g.unpushed.length)) out.push({ label: 'edited', kind: 'edited' });
    if (g.fork) out.push({ label: 'fork', kind: 'fork' });
    return out;
}
