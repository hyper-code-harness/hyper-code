/**
 * Quotes a string or remote path for safe use in a bash command line on an SSH host.
 *
 * Single-quotes the value for bash. With path: true a leading ~ or ~/ stays unquoted so the remote shell expands it to the remote home, and the rest is quoted. Use it whenever you build remote.exec commands from user-supplied values or paths.
 * @param opts.value Text or path to quote.
 * @param opts.path Treat value as a path and keep a leading ~ or ~/ expandable. @default false
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Text or path to quote. */
        value: string;
        /** Treat value as a path and keep a leading ~ or ~/ expandable. @default false */
        path?: boolean;
    },
): string {
    const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const v = opts.value;
    if (!opts.path) return q(v);
    if (v === "~") return "~";
    if (v.startsWith("~/")) return v.length === 2 ? "~/" : "~/" + q(v.slice(2));
    return q(v);
}
