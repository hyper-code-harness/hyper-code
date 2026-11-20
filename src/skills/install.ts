const NAME = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Installs or updates a pack of standard Agent Skills from a git repository, after a preview
 *
 * Use to add skills written for Claude Code, Codex or any agentskills.io client — a repository of `<name>/SKILL.md`
 * folders with no Hyper code. The first call clones the repository into staging, checks out the newest `vX.Y.Z` tag
 * (or `ref`: a tag, a branch or a commit; the default branch when there are no release tags), finds and checks the
 * skill folders (skills.inspectPack) and returns a preview: the skills with descriptions, files that look executable,
 * what is added, changed and removed against the installed copy, and a `digest`. Nothing changes until the same call
 * is repeated with `confirmed: true` and that digest. Then the clone is moved to ~/.hyper/skills/<pack>, recorded in
 * the skills lock with the commit and a hash per skill, and indexed. Nothing from the repository is executed — no
 * scripts, no package.json, no hooks. A pack from a publisher's own repository (anthropics/*, openai/*) is `official`
 * and its skills are allowed to the model at once; anything else is `community`: a person can start its skills with
 * /name, and the model may only after skills.allowModel or `allowModel: true` here. Calling it again for an installed
 * pack updates it and keeps its settings.
 * @param opts.repo Repository: `github:owner/repo`, an https or ssh address, or (for a repository on this machine) `git+file:///path`.
 * @param opts.ref Tag, branch or commit (7–40 hex) to install instead of the newest release.
 * @param opts.select Skill names, globs over skill folders (`skills/engineering/*`) or marketplace set names to keep; default is what the repository's manifest lists.
 * @param opts.as Pack name to install under; defaults to the installed pack of this repository, else the repository owner.
 * @param opts.allowModel Let the model start skills of this pack by itself; defaults to true for official packs and to the current setting on update.
 * @param opts.confirmed Apply the previewed change. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 * @param opts.expectedContent Content digest of the skills a person looked at (skills.preview); confirms instead of expectedDigest when the same content is what gets installed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository: `github:owner/repo`, an https or ssh address, or (for a repository on this machine) `git+file:///path`. */
    repo: string;
    /** Tag, branch or commit (7–40 hex) to install instead of the newest release. */
    ref?: string;
    /** Skill names, globs over skill folders (`skills/engineering/*`) or marketplace set names to keep; default is what the repository's manifest lists. */
    select?: string[];
    /** Pack name to install under; defaults to the installed pack of this repository, else the repository owner. */
    as?: string;
    /** Let the model start skills of this pack by itself; defaults to true for official packs and to the current setting on update. */
    allowModel?: boolean;
    /** Apply the previewed change. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
    /** Content digest of the skills a person looked at (skills.preview); confirms instead of expectedDigest when the same content is what gets installed. */
    expectedContent?: string;
}): Promise<{
    status: "preview" | "applied";
    operation: "install" | "update";
    pack: string;
    repo: string;
    tag?: string;
    branch?: string;
    commit: string;
    from?: string;
    trust: "official" | "listed" | "community";
    model: boolean;
    found: string;
    skills: Array<{ name: string; path: string; description: string; byModel: boolean; byUser: boolean; bodyChars: number; files: number; executables: string[]; diagnostics: string[]; change: "added" | "changed" | "same" }>;
    removed: string[];
    skipped: Array<{ path: string; reason: string }>;
    digest: string;
    /** Digest of the skills' content alone (names, folders, file hashes): the same for a preview and an install of the same commit. */
    content: string;
    indexed?: number;
}> {
    if (opts.confirmed) ctx.fns.skills.personOnly({ what: "install a skill pack" });
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const paths = await ctx.fns.skills.paths({});
    const parsedRepo = await ctx.fns.plugins.repoUrl({ repo: String(opts.repo ?? "") });
    const repo = parsedRepo.source;
    const { lock } = await ctx.fns.skills.lockFile({});

    const sameRepo = Object.entries(lock.packs).find(([, e]) => e.repo === repo)?.[0];
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    const owner = parsedRepo.github?.split("/")[0] ?? path.basename(parsedRepo.url).replace(/\.git$/, "");
    const pack = opts.as ? String(opts.as) : sameRepo ?? slug(owner);
    if (!NAME.test(pack) || pack === "local") throw new Error(`Pack name "${pack}" is not usable: lowercase letters, digits and hyphens, starting with a letter, and not "local"`);
    const current = lock.packs[pack];
    if (current && current.repo !== repo) throw new Error(`Pack ${pack} is installed from ${current.repo}; give another name with \`as\``);
    const operation: "install" | "update" = current ? "update" : "install";
    const target = path.join(paths.packs, pack);
    const trust: "official" | "listed" | "community" = /^github:(anthropics|openai)\//.test(repo) ? "official" : "community";
    const model = opts.allowModel ?? current?.model ?? trust !== "community";
    // `*` = everything the repository lists: it also clears a narrower selection the lock remembers.
    const select = opts.select?.includes("*") ? undefined : opts.select?.length ? opts.select.map(String) : current?.select;

    await fs.mkdir(paths.home, { recursive: true });
    try { await fs.mkdir(paths.mutex); }
    catch { throw new Error("Another skills operation is running"); }
    let stage = "";
    try {
        const staging = await ctx.fns.skills.stage({ repo, ref: opts.ref, select, label: pack });
        stage = staging.stage;
        const staged = staging.dir;
        const { tag, commit, inspected } = staging;
        const branch = staging.branch ?? (tag ? undefined : current?.branch);
        if (!inspected.skills.length) {
            const all = select?.length ? await ctx.fns.skills.inspectPack({ dir: staged }).catch(() => null) : null;
            throw new Error(`No skills found in ${repo}${select?.length ? ` for ${select.join(", ")}` : ""}` + (all?.skills.length ? `. It has: ${all.skills.map(s => s.name).slice(0, 40).join(", ")}` : ""));
        }
        const was = current?.skills ?? {};
        const skills = inspected.skills.map(s => ({
            name: s.name, path: s.path, description: s.description, byModel: s.modelInvocable, byUser: s.userInvocable, bodyChars: s.bodyChars, files: s.files,
            executables: s.executables, diagnostics: s.diagnostics, change: (!was[s.name] ? "added" : was[s.name]!.hash === s.hash ? "same" : "changed") as "added" | "changed" | "same",
        }));
        const removed = Object.keys(was).filter(name => !inspected.skills.some(s => s.name === name)).sort();
        const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify({ operation, pack, repo, commit, content: inspected.digest, from: current?.commit ?? null, model, select: select ?? null })).digest("hex");
        const result = {
            operation, pack, repo, ...(tag ? { tag } : {}), ...(branch ? { branch } : {}), commit, ...(current ? { from: current.commit } : {}),
            trust, model, found: inspected.found, skills, removed, skipped: inspected.skipped, digest, content: inspected.digest,
        };
        if (!opts.confirmed) return { status: "preview", ...result };
        if (opts.expectedDigest !== digest && !(opts.expectedContent && opts.expectedContent === inspected.digest)) throw new Error("Preview digest mismatch: preview again");

        await fs.mkdir(paths.packs, { recursive: true });
        const old = path.join(stage, "previous");
        const had = await fs.stat(target).then(() => true, () => false);
        if (had) await fs.rename(target, old);
        try { await fs.rename(staged, target); }
        catch (error) { if (had) await fs.rename(old, target); throw error; }
        const previous = current ? [...current.previous, { ...(current.tag ? { tag: current.tag } : {}), ...(current.branch ? { branch: current.branch } : {}), commit: current.commit }].slice(-20) : [];
        lock.packs[pack] = {
            repo, trust, model, ...(tag ? { tag } : {}), ...(branch ? { branch } : {}), commit, previous,
            ...(select?.length ? { select } : {}),
            skills: Object.fromEntries(inspected.skills.map(s => [s.name, { path: s.path, hash: s.hash }])),
            installedAt: Date.now(),
        };
        await ctx.fns.skills.lockFile({ lock });
        const indexed = await ctx.fns.skills.index({});
        return { status: "applied", ...result, indexed: indexed.indexed };
    } finally {
        if (stage) await fs.rm(stage, { recursive: true, force: true });
        await fs.rmdir(paths.mutex).catch(() => undefined);
    }
}
