/** Check whether a GitHub issue draft file appeared in the workspace.
 *
 * Use as a `runtime.fn` predicate for agent.wakeUpWhen: it scans the workspace
 * root for issue draft files (issue*.md / ISSUE*.md, case-insensitive) and
 * reports the first non-empty one found, so the agent can resume and open the
 * issue from that content.
 *
 * @param opts.pattern Glob, relative to the workspace root, used to look for the draft file.
 * @param opts.minBytes Minimum file size in bytes before the draft counts as ready.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Glob, relative to the workspace root, matching candidate issue draft files. @default "[iI][sS][sS][uU][eE]*.md" */
        pattern?: string;
        /** Minimum file size in bytes before the draft counts as ready. @default 1 @minimum 0 */
        minBytes?: number;
    },
): Promise<{ ready: boolean; result?: { path: string; bytes: number; text: string } }> {
    const pattern = opts.pattern ?? "[iI][sS][sS][uU][eE]*.md";
    const minBytes = Math.max(0, Number(opts.minBytes ?? 1));
    const { dir } = await ctx.fns.workspace.get({});

    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true, dot: false })) {
        const path = `${dir}/${rel}`;
        const file = Bun.file(path);
        const bytes = file.size;
        if (bytes < minBytes) continue;
        const text = await file.text();
        if (!text.trim()) continue;
        return { ready: true, result: { path, bytes, text: text.slice(0, 20_000) } };
    }
    return { ready: false };
}
