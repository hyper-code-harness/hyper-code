/**
 * Stops a remote background job started with remote.start.
 *
 * Sends Ctrl-C to the job's tmux session, waits up to the grace period, then kills the session. The log file is kept for remote.logs.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.name Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore.
 * @param opts.grace Seconds to wait after Ctrl-C before killing the session. @default 5 @minimum 0 @maximum 60
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore. */
        name: string;
        /** Seconds to wait after Ctrl-C before killing the session. @default 5 @minimum 0 @maximum 60 */
        grace?: number;
    },
): Promise<{ name: string; wasRunning: boolean; killed: boolean }> {
    if (!/^[A-Za-z0-9._-]+$/.test(opts.name)) throw new Error("invalid job name: " + opts.name);
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const sess = "hyper-" + opts.name;
    const log = "$HOME/.hyper-jobs/" + opts.name + ".log";
    const g = Math.max(0, Math.min(60, opts.grace ?? 5));
    const script = "tmux has-session -t " + sess + " 2>/dev/null || { echo WAS=0; exit 0; }; echo WAS=1; tmux send-keys -t " + sess + " C-c; for i in $(seq 1 " + g * 4 + "); do tmux has-session -t " + sess + " 2>/dev/null || { echo KILLED=0; exit 0; }; sleep 0.25; done; tmux kill-session -t " + sess + "; echo KILLED=1";
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: g + 20 });
    if (r.exitCode !== 0) throw new Error(opts.host + ": " + r.stderr.trim());
    return { name: opts.name, wasRunning: r.stdout.includes("WAS=1"), killed: r.stdout.includes("KILLED=1") };
}
