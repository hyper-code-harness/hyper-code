async function readAll(stream?: ReadableStream<Uint8Array> | null): Promise<string> {
    if (!stream) return "";
    return await new Response(stream).text();
}

/**
 * Runs a git command in the agent workspace, locally or on the workspace's SSH host.
 *
 * Follows the same rule as the file tools (workspace.target): no host → the
 * agent workspace (remote when it has a host); host "local" → this machine; any
 * other alias → that host. dir overrides the working directory; relative dirs
 * resolve against the workspace dir on the workspace host. Arguments are passed
 * as quoted shell words remotely, argv locally.
 * @param opts.args git arguments, without the leading "git".
 * @param opts.dir Working directory; defaults to the workspace directory.
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace.
 * @param opts.allowFailure Return a failed result instead of throwing. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** git arguments, without the leading "git". */
        args: string[];
        /** Working directory; defaults to the workspace directory. */
        dir?: string;
        /** SSH host alias, or "local"; omitted means the agent workspace. */
        host?: string;
        /** Return a failed result instead of throwing. @default false */
        allowFailure?: boolean;
    },
): Promise<types.git.Result> {
    const args = opts.args;
    // Local is the common case and needs nothing but the session: only a remote
    // workspace or an explicit host goes through workspace.target.
    const remote = (opts.host && opts.host !== "local") || (!opts.host && session?.agent?.workspaceHost);
    const at = remote
        ? ctx.fns.workspace.target({ host: opts.host, path: opts.dir })
        : { host: null, path: opts.dir ?? (opts.host === "local" && session?.agent?.workspaceHost ? process.cwd() : session?.agent?.workspaceDir ?? process.cwd()) };
    let out: types.git.Result;
    if (at.host) {
        const q = (s: string) => ctx.fns.remote.quote({ value: s });
        // GIT_TERMINAL_PROMPT=0: a credential prompt would hang a non-interactive session.
        const r = await ctx.fns.remote.exec({ host: at.host, cwd: at.path, command: "GIT_TERMINAL_PROMPT=0 git " + args.map(q).join(" "), timeout: 300 });
        out = { ok: r.exitCode === 0, code: r.exitCode ?? -1, stdout: r.stdout, stderr: r.timedOut ? `git timed out on ${at.host}\n${r.stderr}` : r.stderr };
    } else {
        const proc = Bun.spawn(["git", ...args], {
            cwd: at.path,
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
            readAll(proc.stdout),
            readAll(proc.stderr),
            proc.exited,
        ]);
        out = { ok: code === 0, code, stdout, stderr };
    }
    if (!out.ok && !opts.allowFailure) throw new Error(out.stderr || out.stdout || `git exited with code ${out.code}`);
    return out;
}
