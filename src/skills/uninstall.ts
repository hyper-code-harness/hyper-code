/**
 * Removes an installed skill pack from ~/.hyper/skills, after a preview
 *
 * Use to uninstall what skills.install put there. The first call previews which skills go away and returns a digest;
 * nothing changes until the call is repeated with `confirmed: true` and that digest. Then the folder is deleted, the
 * pack leaves the skills lock and its rows leave the search index. Skills of the shared folders (pack `local`) are
 * not Hyper's to remove.
 * @param opts.name Pack name, as skills.lockFile lists it.
 * @param opts.confirmed Apply the previewed removal. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Pack name, as skills.lockFile lists it. */
    name: string;
    /** Apply the previewed removal. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
}): Promise<{ status: "preview" | "applied"; pack: string; repo: string; commit: string; skills: string[]; digest: string }> {
    if (opts.confirmed) ctx.fns.skills.personOnly({ what: "remove a skill pack" });
    const fs = await import("node:fs/promises");
    const { join } = await import("node:path");
    const paths = await ctx.fns.skills.paths({});
    const { lock } = await ctx.fns.skills.lockFile({});
    const pack = String(opts.name ?? "");
    const entry = lock.packs[pack];
    if (!entry) throw new Error(`Skill pack ${pack} is not installed`);
    const skills = Object.keys(entry.skills).sort();
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify({ operation: "remove", pack, repo: entry.repo, commit: entry.commit, skills })).digest("hex");
    const result = { pack, repo: entry.repo, commit: entry.commit, skills, digest };
    if (!opts.confirmed) return { status: "preview", ...result };
    if (opts.expectedDigest !== digest) throw new Error("Preview digest mismatch: preview again");
    try { await fs.mkdir(paths.mutex); }
    catch { throw new Error("Another skills operation is running"); }
    try {
        await fs.rm(join(paths.packs, pack), { recursive: true, force: true });
        delete lock.packs[pack];
        await ctx.fns.skills.lockFile({ lock });
        await ctx.fns.skills.index({ embed: false });
    } finally {
        await fs.rmdir(paths.mutex).catch(() => undefined);
    }
    return { status: "applied", ...result };
}
