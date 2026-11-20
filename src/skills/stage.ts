/**
 * Clones a skills repository into staging at one ref and inspects its skills, without installing anything
 *
 * Use from skills.install (which then activates the clone) and skills.preview (which only looks). Checks out the
 * given ref — a tag, a branch or a commit — or, without one, the newest `vX.Y.Z` tag, or the default branch when the
 * repository has no release tags, and runs skills.inspectPack on the clone. The caller owns the returned `stage`
 * folder and must remove it. Nothing from the repository is executed.
 * @param opts.repo Repository: `github:owner/repo`, an https or ssh address, or `git+file:///path` on this machine.
 * @param opts.ref Tag, branch or commit (7–40 hex) instead of the newest release.
 * @param opts.select Skill names, folder globs or marketplace set names to keep.
 * @param opts.label Short name used for the staging folder. @default "pack"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository: `github:owner/repo`, an https or ssh address, or `git+file:///path` on this machine. */
    repo: string;
    /** Tag, branch or commit (7–40 hex) instead of the newest release. */
    ref?: string;
    /** Skill names, folder globs or marketplace set names to keep. */
    select?: string[];
    /** Short name used for the staging folder. @default "pack" */
    label?: string;
}): Promise<types.skills.Staged> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const paths = await ctx.fns.skills.paths({});
    const parsed = await ctx.fns.plugins.repoUrl({ repo: String(opts.repo ?? "") });
    const label = String(opts.label ?? "pack").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "pack";
    const git = async (cwd: string, args: string[], allowFail = false): Promise<string> => {
        const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        if (code && !allowFail) throw new Error(`git ${args[0]} failed: ${err.trim().slice(0, 300)}`);
        return code ? "" : out.trim();
    };
    await fs.mkdir(paths.staging, { recursive: true });
    const stage = await fs.mkdtemp(path.join(paths.staging, label + "-"));
    try {
        const dir = path.join(stage, label);
        // Partial clone: history and trees now, file contents only for the commit that gets checked out.
        await git(stage, ["clone", "-q", "--no-checkout", "--filter=blob:none", parsed.url, dir]);
        let tag: string | undefined, branch: string | undefined, commit = "";
        const rev = (r: string) => git(dir, ["rev-parse", "--verify", "-q", `${r}^{commit}`], true);
        const ref = String(opts.ref ?? "").trim();
        if (ref) {
            if (/[^A-Za-z0-9._\/-]/.test(ref) || ref.startsWith("-")) throw new Error("Unsafe ref");
            if ((commit = await rev(`refs/tags/${ref}`))) tag = ref;
            else if ((commit = await rev(`refs/remotes/origin/${ref}`))) branch = ref;
            else if (!(/^[0-9a-f]{7,40}$/.test(ref) && (commit = await rev(ref)))) throw new Error(`No tag, branch or commit ${ref} in ${parsed.source}`);
            // A bare commit that is the head of the default branch is that branch: updates then know what to follow.
            if (!tag && !branch) {
                const head = (await git(dir, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], true)).replace(/^origin\//, "");
                if (head && await rev(`refs/remotes/origin/${head}`) === commit) branch = head;
            }
        } else {
            const newest = (await git(dir, ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"])).split("\n").find(t => /^v\d+\.\d+\.\d+$/.test(t));
            if (newest) { tag = newest; commit = await rev(`refs/tags/${newest}`); }
            else {
                branch = (await git(dir, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], true)).replace(/^origin\//, "") || "main";
                commit = await rev(`refs/remotes/origin/${branch}`);
            }
        }
        if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Could not resolve what to install from ${parsed.source}`);
        await git(dir, ["checkout", "-q", "--detach", commit]);
        const inspected = await ctx.fns.skills.inspectPack({ dir, select: opts.select });
        const owner = parsed.github?.split("/")[0] ?? path.basename(parsed.url).replace(/\.git$/, "");
        return { stage, dir, repo: parsed.source, owner, ...(tag ? { tag } : {}), ...(branch ? { branch } : {}), commit, inspected };
    } catch (error) {
        await fs.rm(stage, { recursive: true, force: true });
        throw error;
    }
}
