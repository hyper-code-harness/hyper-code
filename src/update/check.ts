/**
 * Checks whether this Hyper checkout has a safe fast-forward update available
 *
 * Optionally fetches the configured upstream, then reports current and upstream revisions, ahead/behind counts, working-tree cleanliness and whether a guarded update can be requested. Results are cached briefly for navigation UI.
 * @param opts.fetch Fetch the upstream remote before comparing revisions. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Fetch the upstream remote before comparing revisions. @default false */
        fetch?: boolean;
    },
): Promise<{ state: "current" | "available" | "dirty" | "diverged" | "unconfigured" | "error"; current?: string; target?: string; upstream?: string; ahead: number; behind: number; clean: boolean; checkedAt: number; message: string }> {
    type State = "current" | "available" | "dirty" | "diverged" | "unconfigured" | "error";
    const root = String((ctx.state as any).root ?? process.cwd());
    const cache = ((ctx.state as any).update ??= {});
    const git = async (args: string[], allowFailure = false) => ctx.fns.git.run({ args, dir: root, host: "local", allowFailure });
    const checkedAt = Date.now();
    try {
      if (opts.fetch) { const f = await git(["fetch", "--quiet"], true); if (!f.ok) throw new Error((f.stderr || f.stdout || "git fetch failed").trim()); }
      const upstreamResult = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], true);
      if (!upstreamResult.ok) return cache.status = { state: "unconfigured" as State, ahead: 0, behind: 0, clean: false, checkedAt, message: "No git upstream configured" };
      const upstream = upstreamResult.stdout.trim();
      const [head, target, counts, tree] = await Promise.all([
        git(["rev-parse", "HEAD"]), git(["rev-parse", "@{upstream}"]), git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]), git(["status", "--porcelain=v1"]),
      ]);
      const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
      const clean = tree.stdout.trim() === "";
      const current = head.stdout.trim(), targetSha = target.stdout.trim();
      const state: State = ahead && behind ? "diverged" : behind && !clean ? "dirty" : behind ? "available" : "current";
      const message = state === "dirty" ? "Update blocked: working tree has changes" : state === "diverged" ? `Update blocked: branch diverged (ahead ${ahead}, behind ${behind})` : state === "available" ? `${behind} update${behind === 1 ? "" : "s"} available` : "Hyper is up to date";
      return cache.status = { state, current, target: targetSha, upstream, ahead: ahead || 0, behind: behind || 0, clean, checkedAt, message };
    } catch (error) { return cache.status = { state: "error" as State, ahead: 0, behind: 0, clean: false, checkedAt, message: String(error instanceof Error ? error.message : error) }; }
}
