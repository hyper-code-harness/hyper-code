/**
 * Lists background jobs started with remote.start on an SSH server.
 *
 * Returns every job that has a log in ~/.hyper-jobs, whether its tmux session is running, and its last log line.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
    },
): Promise<Array<{ name: string; running: boolean; lastLine: string }>> {
    const script = 'mkdir -p ~/.hyper-jobs; for f in ~/.hyper-jobs/*.log; do [ -f "$f" ] || continue; n=$(basename "$f" .log); r=0; tmux has-session -t "hyper-$n" 2>/dev/null && r=1; printf "%s\\t%s\\t%s\\n" "$n" "$r" "$(tail -n 1 "$f" | tr -d "\\t" | cut -c1-200)"; done';
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: 30 });
    if (r.exitCode !== 0) throw new Error(opts.host + ": " + r.stderr.trim());
    return r.stdout.split("\n").filter(Boolean).map(l => { const [name, run, last] = l.split("\t"); return { name: name!, running: run === "1", lastLine: last ?? "" }; });
}
