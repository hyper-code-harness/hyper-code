// Search the workspace. Declared by $tool_grep.md.
//
// Output is ripgrep's own shape, which every model has read a thousand times:
//   path:LINE:COL: matched text        (path:ANCHOR:COL: in hashline mode)
//   path-LINE- context line
// Blocks are separated by `--`, and over-long lines are cut — one minified file
// otherwise buries the whole result.
//
// Two things the model is TOLD rather than left to guess: that the result was
// cut at the limit (silence there reads as "that is everything"), and that
// ripgrep is missing so this search was slower and less thorough than it looks.
const MAX_LINE = 400;

/**
 * Implements bounded content search in the local workspace or on a remote SSH host.
 *
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.pattern Regular expression, or plain text when literal is true.
 * @param opts.path Directory or file to search; workspace-relative locally, relative to the remote home with host.
 * @param opts.glob File glob restricting searched files.
 * @param opts.ignoreCase Case-insensitive matching. @default false
 * @param opts.literal Treat the pattern as literal text. @default false
 * @param opts.context Context lines before and after each match. @default 0
 * @param opts.limit Maximum number of matches. @default 50 @minimum 1
 * @param opts.noIgnore Include files ignored by .gitignore. @default false
 * @param opts.hidden Include hidden paths. @default false
 * @param opts.timeout Seconds before the search is cut short.
 * @param opts.hashline Emit stable line anchors instead of line numbers. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Glob or search pattern. */
        pattern: string; /** Workspace-relative path. */ path?: string; /** Glob restricting searched files. */ glob?: string; /** Whether matching is case-insensitive. */ ignoreCase?: boolean; /** Whether to treat the pattern as literal text. */ literal?: boolean;
        /** Number of context lines around each match. */
        context?: number; /** Maximum number of results. */ limit?: number; /** Whether to include ignored files. */ noIgnore?: boolean; /** Whether to include hidden paths. */ hidden?: boolean; /** Timeout in seconds. */ timeout?: number; /** Whether to emit stable line anchors. */ hashline?: boolean;
    },
): Promise<string> {
    const limit = Math.max(1, opts.limit ?? 50);
    const query = {
        pattern: opts.pattern,
        path: opts.path || undefined,
        glob: opts.glob || undefined,
        ignoreCase: opts.ignoreCase === true,
        literal: opts.literal === true,
        context: opts.context,
        limit,
        noIgnore: opts.noIgnore === true,
        hidden: opts.hidden === true,
        timeout: opts.timeout,
    };

    let remoteEngine: string | null = null;
    let rows: any[];
    if (opts.host) {
        const r = await ctx.fns.remote.grep({ ...query, host: opts.host });
        remoteEngine = r.engine;
        rows = opts.hashline
            ? r.matches.map(m => ({ ...m, anchor: `${m.line}${ctx.fns.files.lineHash({ line: m.line, text: m.text })}` }))
            : r.matches;
    } else {
        rows = opts.hashline
            ? await ctx.fns.files.grepHashline(query)
            : await ctx.fns.files.grep(query);
    }

    let truncatedLines = false;
    const cut = (text: string): string => {
        const t = String(text ?? "").replaceAll("\r", "");
        if (t.length <= MAX_LINE) return t;
        truncatedLines = true;
        return `${t.slice(0, MAX_LINE)}… (+${t.length - MAX_LINE} chars)`;
    };

    const blocks = rows.map(r => {
        const head = `${r.path}:${opts.hashline ? r.anchor : r.line}:${r.column}: ${cut(r.text)}`;
        if (!opts.context) return head;
        const first = r.line - (r.before?.length ?? 0);
        return [
            ...(r.before ?? []).map((l: string, i: number) => `${r.path}-${first + i}- ${cut(l)}`),
            head,
            ...(r.after ?? []).map((l: string, i: number) => `${r.path}-${r.line + 1 + i}- ${cut(l)}`),
        ].join("\n");
    });
    const body = blocks.join(opts.context ? "\n--\n" : "\n");

    const notes: string[] = [];
    if (remoteEngine === "grep") {
        notes.push(`NOTE: ripgrep is not installed on ${opts.host}; searched with grep -r (no .gitignore support).`);
    } else if (!opts.host && !ctx.fns.files.rgPath({})) {
        notes.push("WARNING: ripgrep (rg) is not installed, so this ran on the slow in-process fallback: "
            + "no .gitignore support and no parallel search. Install it — `brew install ripgrep` — and tell the user.");
    }
    if (rows.length >= limit) {
        notes.push(`NOTE: stopped at the limit of ${limit} matches — there may be more. Narrow the pattern or raise limit.`);
    }
    if (truncatedLines) notes.push(`NOTE: some lines were cut at ${MAX_LINE} chars. Read the file for the full line.`);
    if (!rows.length) notes.push("(no matches)");

    return [body, ...notes].filter(Boolean).join(body && notes.length ? "\n\n" : "");
}
