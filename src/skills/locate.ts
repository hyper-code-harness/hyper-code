/**
 * Finds the folder of one skill for the viewer: an installed or shared-folder skill, or a skill inside a preview
 *
 * Use from skills.view and skills.file so both look at the same thing whether the skill is installed or only
 * previewed. Without `preview`, `name` is resolved in the index (skills.resolve). With `preview`, the skill is taken
 * from that preview's clone; nothing there is indexed or loadable. Returns the folder, its files (links are never
 * followed) and what is known about the origin.
 * @param opts.name Skill name: short or `pack:name`; in a preview, the short name.
 * @param opts.preview Preview id from skills.preview.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Skill name: short or `pack:name`; in a preview, the short name. */
    name: string;
    /** Preview id from skills.preview. */
    preview?: string;
}): Promise<{
    found: boolean;
    candidates: string[];
    id: string;
    name: string;
    pack: string;
    dir: string;
    files: string[];
    executables: string[];
    installed: boolean;
    trust: string;
    repo: string | null;
    ref: string | null;
    commit: string | null;
    preview: types.skills.PackPreview | null;
    skill: types.skills.Skill | null;
}> {
    const path = await import("node:path");
    const none = { found: false, candidates: [] as string[], id: "", name: String(opts.name ?? ""), pack: "", dir: "", files: [] as string[], executables: [] as string[], installed: false, trust: "", repo: null, ref: null, commit: null, preview: null, skill: null };
    const SCRIPT = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/i;
    if (opts.preview) {
        if (!/^[0-9a-f]{20}$/.test(String(opts.preview))) return none;
        const base = path.join((await ctx.fns.skills.paths({})).staging, "preview", String(opts.preview));
        const stored = await Bun.file(path.join(base, "preview.json")).json().catch(() => null) as types.skills.PackPreview | null;
        if (!stored) return none;
        // Installed or not is read from the lock now, not from when the preview was fetched.
        const { lock } = await ctx.fns.skills.lockFile({});
        const installedAs = Object.entries(lock.packs).find(([, e]) => e.repo === stored.repo)?.[0];
        const was = installedAs ? lock.packs[installedAs]!.skills : {};
        const { installedAs: _old, ...rest } = stored;
        const preview: types.skills.PackPreview = { ...rest, ...(installedAs ? { installedAs, pack: installedAs } : {}), skills: stored.skills.map(s => ({ ...s, change: !installedAs ? "new" : !was[s.name] ? "added" : was[s.name]!.hash === s.hash ? "same" : "changed" })) };
        const entry = preview.skills.find(s => s.name === String(opts.name ?? "").replace(/^.*:/, ""));
        if (!entry) return { ...none, preview, candidates: preview.skills.map(s => s.name) };
        const dir = path.join(base, "repo", entry.path);
        const tree = await ctx.fns.skills.hashDir({ dir });
        return {
            found: true, candidates: [], id: `${preview.pack}:${entry.name}`, name: entry.name, pack: preview.pack, dir, files: tree.files, executables: entry.executables,
            installed: false, trust: preview.trust, repo: preview.repo, ref: preview.tag ?? preview.branch ?? null, commit: preview.commit, preview, skill: null,
        };
    }
    const resolved = await ctx.fns.skills.resolve({ name: String(opts.name ?? "") });
    if (!resolved.skill) return { ...none, candidates: resolved.candidates };
    const skill = resolved.skill;
    const tree = await ctx.fns.skills.hashDir({ dir: skill.dir }).catch(() => ({ files: [] as string[] }));
    const { lock } = await ctx.fns.skills.lockFile({});
    const pack = lock.packs[skill.pack];
    return {
        found: true, candidates: [], id: skill.id, name: skill.name, pack: skill.pack, dir: skill.dir, files: tree.files, executables: tree.files.filter(file => SCRIPT.test(file)),
        installed: true, trust: skill.trust, repo: pack?.repo ?? null, ref: pack ? pack.tag ?? pack.branch ?? null : null, commit: pack?.commit ?? null, preview: null, skill,
    };
}
