/**
 * Returns a structured git working-tree status, locally or on the workspace SSH host.
 *
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace (remote when it has a host).
 * @param opts.dir Repository working directory; defaults to the workspace directory.
 * @param opts.staged Inspect staged changes only (untracked files omitted). @default false
 * @param opts.summary Return a compact summary shape. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** SSH host alias, or "local"; omitted means the agent workspace. */ host?: string; /** Git working directory. */ dir?: string; /** Whether to inspect staged changes only. */ staged?: boolean; /** Whether to return summary output. */ summary?: boolean } = {}) {
    const raw = await ctx.fns.git.run({ args: ["status", "--porcelain=v1", "-z", ...(opts.staged ? ["--untracked-files=no"] : [])], dir: opts.dir, host: opts.host });
    const modified = new Set<string>();
    const staged = new Set<string>();
    const untracked = new Set<string>();
    const deleted = new Set<string>();
    const renamed: Array<{ from: string; to: string }> = [];
    let clean = true;
    for (const line of raw.stdout.split("\0").filter(Boolean)) {
        const xy = line.slice(0, 2);
        const x = xy[0] ?? " ";
        const y = xy[1] ?? " ";
        const payload = line.slice(3);
        if (xy === "!!") continue;
        clean = false;
        if (xy === "??") {
            untracked.add(payload);
            continue;
        }
        let path = payload;
        if (payload.includes(" -> ")) {
            const [from = '', to = ''] = payload.split(" -> ");
            renamed.push({ from, to });
            path = to;
        }
        if (x !== " " && x !== "?") staged.add(path);
        if (y !== " ") modified.add(path);
        if (x === "D" || y === "D") deleted.add(path);
    }
    const modifiedList = [...modified];
    const stagedList = [...staged];
    const untrackedList = [...untracked];
    const deletedList = [...deleted];
    const total = new Set([
        ...modifiedList,
        ...stagedList,
        ...untrackedList,
        ...deletedList,
        ...renamed.map((x) => x.to),
    ]).size;
    if (opts.summary) {
        return {
            clean,
            ...(clean ? {} : {
                total,
                ...(modifiedList.length ? { modified: modifiedList.length } : {}),
                ...(stagedList.length ? { staged: stagedList.length } : {}),
                ...(untrackedList.length ? { untracked: untrackedList.length } : {}),
                ...(deletedList.length ? { deleted: deletedList.length } : {}),
                ...(renamed.length ? { renamed: renamed.length } : {}),
            }),
        };
    }
    if (opts.staged) {
        return {
            clean: stagedList.length === 0 && renamed.length === 0 && deletedList.filter((p) => staged.has(p)).length === 0,
            ...(stagedList.length ? { staged: stagedList } : {}),
            ...(renamed.length ? { renamed } : {}),
            ...(() => { const stagedDeleted = deletedList.filter((p) => staged.has(p)); return stagedDeleted.length ? { deleted: stagedDeleted } : {}; })(),
        };
    }
    return {
        clean,
        ...(modifiedList.length ? { modified: modifiedList } : {}),
        ...(stagedList.length ? { staged: stagedList } : {}),
        ...(untrackedList.length ? { untracked: untrackedList } : {}),
        ...(deletedList.length ? { deleted: deletedList } : {}),
        ...(renamed.length ? { renamed } : {}),
    };
}
