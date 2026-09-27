// Create or overwrite a file with exactly the given bytes. Declared by
// $tool_write.md; callable by hand as ctx.fns.tools.write({ path, content }).
//
// The parse check is feedback, not a gate: the write stands either way, but a
// code file that does not even parse is a mistake the model can fix NOW —
// usually prose glued onto the end of the body.
/**
 * Implements the file-writing tool for the local workspace or a remote SSH host.
 *
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host).
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 * @param opts.content Full file body written verbatim.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host). */ host?: string; /** Workspace-relative path. */ path: string; /** Content to write. */ content: string },
): Promise<string> {
    if (!opts.path.trim() || opts.path.includes("\u0000")) throw new Error("write needs a valid file path");
    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.path });
    const host = at.host ?? undefined;
    await ctx.fns.files.write({ path: host ? at.path : opts.path, host, content: opts.content });
    const lines = opts.content.split("\n").length;
    let output = `wrote ${host ? host + ":" + at.path : opts.path} (${opts.content.length} bytes, ${lines} lines)`;

    const loader = /\.tsx$/.test(opts.path) ? "tsx"
        : /\.ts$/.test(opts.path) ? "ts"
        : /\.jsx$/.test(opts.path) ? "jsx"
        : /\.(js|mjs)$/.test(opts.path) ? "js"
        : null;
    if (loader) {
        try {
            new Bun.Transpiler({ loader: loader as any }).transformSync(opts.content);
        } catch (pe: any) {
            output += `\nWARNING: the file does NOT parse (${String(pe?.message ?? pe).split("\n")[0]?.slice(0, 160)}). ` +
                "If you wrote prose after the code, close the §write body with a bare § line first — everything until then goes INTO the file. Fix the file now.";
        }
    }
    return output;
}
