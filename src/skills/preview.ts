/**
 * Fetches a skills repository into a read-only preview so its skills can be looked at before anything is installed
 *
 * Use when a person or an agent wants to see what a pack contains — every SKILL.md, reference and script — before
 * deciding. Clones the repository at the newest release (or `ref`) into ~/.hyper/.skills-staging/preview/<id>,
 * inspects it (skills.inspectPack) and returns the skills with their descriptions and executable files, an `id` for
 * the viewer, and the `content` digest that an install of the same commit will match. A preview is not installed:
 * its skills are not indexed, not offered to any agent and cannot be loaded. The same repository, ref and selection
 * give the same id, so asking again reuses the clone; previews older than a day are removed on the next call.
 * Open it with skills.view({ name, preview: id }) or skills.previewPage({ repo }).
 * @param opts.repo Repository: `github:owner/repo`, an https or ssh address, or `git+file:///path` on this machine.
 * @param opts.ref Tag, branch or commit instead of the newest release.
 * @param opts.select Skill names, folder globs or marketplace set names to keep.
 * @param opts.as Pack name the skills would be installed under; defaults as in skills.install.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository: `github:owner/repo`, an https or ssh address, or `git+file:///path` on this machine. */
    repo: string;
    /** Tag, branch or commit instead of the newest release. */
    ref?: string;
    /** Skill names, folder globs or marketplace set names to keep. */
    select?: string[];
    /** Pack name the skills would be installed under; defaults as in skills.install. */
    as?: string;
}): Promise<types.skills.PackPreview> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const paths = await ctx.fns.skills.paths({});
    const parsed = await ctx.fns.plugins.repoUrl({ repo: String(opts.repo ?? "") });
    const select = (opts.select ?? []).map(String).filter(Boolean);
    const root = path.join(paths.staging, "preview");
    await fs.mkdir(root, { recursive: true });
    // Yesterday's previews go; a preview is a look, not a store.
    for (const name of await fs.readdir(root).catch(() => [] as string[])) {
        const meta = await Bun.file(path.join(root, name, "preview.json")).json().catch(() => null) as types.skills.PackPreview | null;
        if (!meta || Date.now() - Number(meta.createdAt) > 86_400_000) await fs.rm(path.join(root, name), { recursive: true, force: true });
    }
    const id = new Bun.CryptoHasher("sha256").update(JSON.stringify([parsed.source, opts.ref ?? "", select, opts.as ?? ""])).digest("hex").slice(0, 20);
    const dir = path.join(root, id);
    // What is installed changes while a preview sits in the cache, so it is compared with the lock on every call.
    const current = async (p: types.skills.PackPreview): Promise<types.skills.PackPreview> => {
        const { lock } = await ctx.fns.skills.lockFile({});
        const installedAs = Object.entries(lock.packs).find(([, e]) => e.repo === p.repo)?.[0];
        const was = installedAs ? lock.packs[installedAs]!.skills : {};
        const { installedAs: _old, ...rest } = p;
        return {
            ...rest, pack: String(opts.as ?? installedAs ?? p.pack), ...(installedAs ? { installedAs } : {}),
            skills: p.skills.map(s => ({ ...s, change: !installedAs ? "new" : !was[s.name] ? "added" : was[s.name]!.hash === s.hash ? "same" : "changed" })),
        };
    };
    const cached = await Bun.file(path.join(dir, "preview.json")).json().catch(() => null) as types.skills.PackPreview | null;
    // A release tag does not move; a branch may, so a branch preview is reused only for a few minutes.
    if (cached && (cached.tag || Date.now() - Number(cached.createdAt) < 300_000)) return current(cached);

    const staged = await ctx.fns.skills.stage({ repo: parsed.source, ref: opts.ref, ...(select.length ? { select } : {}), label: "preview" });
    try {
        if (!staged.inspected.skills.length) {
            const all = select.length ? await ctx.fns.skills.inspectPack({ dir: staged.dir }).catch(() => null) : null;
            throw new Error(`No skills found in ${parsed.source}${select.length ? ` for ${select.join(", ")}` : ""}` + (all?.skills.length ? `. It has: ${all.skills.map(s => s.name).slice(0, 40).join(", ")}` : ""));
        }
        const pack = String(opts.as ?? staged.owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
        const preview: types.skills.PackPreview = {
            id, repo: parsed.source, ...(staged.tag ? { tag: staged.tag } : {}), ...(staged.branch ? { branch: staged.branch } : {}), commit: staged.commit,
            pack,
            trust: /^github:(anthropics|openai)\//i.test(parsed.source) ? "official" : "community",
            found: staged.inspected.found, ...(select.length ? { select } : {}), ...(opts.ref ? { ref: String(opts.ref) } : {}),
            skills: staged.inspected.skills.map(s => ({
                name: s.name, path: s.path, description: s.description, byModel: s.modelInvocable, byUser: s.userInvocable, bodyChars: s.bodyChars, files: s.files, bytes: s.bytes,
                executables: s.executables, diagnostics: s.diagnostics, hash: s.hash,
                change: "new" as const,
            })),
            skipped: staged.inspected.skipped, content: staged.inspected.digest, createdAt: Date.now(),
        };
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        await fs.rename(staged.dir, path.join(dir, "repo"));
        await Bun.write(path.join(dir, "preview.json"), JSON.stringify(preview, null, 2));
        return current(preview);
    } finally {
        await fs.rm(staged.stage, { recursive: true, force: true });
    }
}
