/**
 * Returns the tail of a remote background job's log and whether it is still running.
 *
 * Reads ~/.hyper-jobs/<name>.log written by remote.start. Optional grep filters lines. Use it to poll servers, builds and watchers started with remote.start.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.name Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore.
 * @param opts.lines Number of trailing lines to return. @default 80 @minimum 1 @maximum 5000
 * @param opts.grep Extended regex; only matching lines are returned (applied before the tail).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore. */
        name: string;
        /** Number of trailing lines to return. @default 80 @minimum 1 @maximum 5000 */
        lines?: number;
        /** Extended regex; only matching lines are returned (applied before the tail). */
        grep?: string;
    },
): Promise<{ name: string; running: boolean; tail: string }> {
    if (!/^[A-Za-z0-9._-]+$/.test(opts.name)) throw new Error("invalid job name: " + opts.name);
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const sess = "hyper-" + opts.name;
    const log = "$HOME/.hyper-jobs/" + opts.name + ".log";
    const n = Math.max(1, Math.min(5000, opts.lines ?? 80));
    const src = opts.grep ? "grep -E -- " + shq(opts.grep) + " " + log + " | tail -n " + n : "tail -n " + n + " " + log;
    const r = await ctx.fns.remote.exec({ host: opts.host, command: "tmux has-session -t " + sess + " 2>/dev/null && echo RUNNING=1 || echo RUNNING=0; [ -f " + log + " ] || { echo 'no log for job " + opts.name + "' >&2; exit 2; }; " + src, timeout: 30 });
    if (r.exitCode !== 0 && !r.stdout.startsWith("RUNNING")) throw new Error(opts.host + ": " + r.stderr.trim());
    if (r.exitCode === 2) throw new Error(opts.host + ": " + r.stderr.trim());
    const [first, ...rest] = r.stdout.split("\n");
    return { name: opts.name, running: first === "RUNNING=1", tail: rest.join("\n") };
}
