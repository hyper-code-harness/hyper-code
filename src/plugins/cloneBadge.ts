/**
 * Turns a plugin clone's git state into its short status badges: the release, edited, a branch ahead of the tag, fork
 *
 * Use wherever an installed plugin is shown (catalog card, plugin page) so the words are the same everywhere.
 * `v1.0.1` — clean at a release tag; `edited` — uncommitted files or commits on no remote; `main +3` — on a branch
 * (or detached) that many commits past its last release tag; `fork` — origin is not the repository it was
 * installed from. Returns them in that order; a clean clone at its tag has exactly one.
 * @param opts.git Clone state from plugins.installed (`git`).
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Clone state from plugins.installed (`git`). */
    git: types.plugins.CloneGit;
}): Array<{ label: string; kind: 'release' | 'edited' | 'ahead' | 'fork' }> {
    const g = opts.git;
    const out: Array<{ label: string; kind: 'release' | 'edited' | 'ahead' | 'fork' }> = [];
    if (g.tag && !g.branch) out.push({ label: g.tag, kind: 'release' });
    else if (g.sinceTag > 0 || g.branch) out.push({ label: `${g.branch ?? 'detached'}${g.sinceTag > 0 ? ' +' + g.sinceTag : ''}`, kind: 'ahead' });
    else out.push({ label: g.baseTag ?? g.commit.slice(0, 7), kind: 'release' });
    if (g.dirty.length || g.unpushed.length) out.push({ label: 'edited', kind: 'edited' });
    if (g.fork) out.push({ label: 'fork', kind: 'fork' });
    return out;
}
