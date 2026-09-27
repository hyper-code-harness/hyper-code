/**
 * Starts a long-running command on an SSH server in a detached tmux session with a log file.
 *
 * Use for servers, watchers, builds and anything that must outlive the call or the SSH connection. Output goes to ~/.hyper-jobs/<name>.log on the remote host; read it with remote.logs, stop with remote.stop, list with remote.jobs. The user can watch live with `ssh <host> -t tmux attach -t hyper-<name>`. Fails if a job with the same name is running unless restart is set. Requires tmux on the remote host.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.name Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore.
 * @param opts.command Bash command to run (via bash -lc with the extended remote.exec PATH).
 * @param opts.cwd Remote working directory; ~/ allowed.
 * @param opts.env Environment variables exported before the command.
 * @param opts.restart Kill a running job with the same name first. @default false
 * @param opts.wait Seconds to wait before returning the first log lines, to catch immediate failures. @default 2 @minimum 0 @maximum 60
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Job name; becomes the tmux session hyper-<name>. Letters, digits, dot, dash and underscore. */
        name: string;
        /** Bash command to run (via bash -lc with the extended remote.exec PATH). */
        command: string;
        /** Remote working directory; ~/ allowed. */
        cwd?: string;
        /** Environment variables exported before the command. */
        env?: Record<string, string>;
        /** Kill a running job with the same name first. @default false */
        restart?: boolean;
        /** Seconds to wait before returning the first log lines, to catch immediate failures. @default 2 @minimum 0 @maximum 60 */
        wait?: number;
    },
): Promise<{ name: string; session: string; running: boolean; log: string; tail: string }> {
    if (!/^[A-Za-z0-9._-]+$/.test(opts.name)) throw new Error("invalid job name: " + opts.name);
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const sess = "hyper-" + opts.name;
    const log = "$HOME/.hyper-jobs/" + opts.name + ".log";
    const exports = Object.entries(opts.env ?? {}).map(([k, v]) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error("invalid env name: " + k); return "export " + k + "=" + shq(v) + "; "; }).join("");
    const cd = opts.cwd ? "cd " + ctx.fns.remote.quote({ value: opts.cwd, path: true }) + " && " : "";
    const inner = ctx.fns.remote.shellPrelude({}) + exports + cd + "( " + opts.command + "\n); echo \"[exit $?] $(date)\"";
    const script = [
      "command -v tmux >/dev/null || { echo 'tmux is not installed' >&2; exit 3; }",
      "mkdir -p ~/.hyper-jobs",
      opts.restart ? "tmux kill-session -t " + sess + " 2>/dev/null; sleep 0.3" : "tmux has-session -t " + sess + " 2>/dev/null && { echo 'job " + opts.name + " is already running (pass restart: true)' >&2; exit 4; }",
      ": > " + log,
      "tmux new-session -d -s " + sess + " " + shq("bash -lc " + shq(inner) + " >> " + log + " 2>&1"),
      "sleep " + Math.max(0, Math.min(60, opts.wait ?? 2)),
      "tmux has-session -t " + sess + " 2>/dev/null && echo RUNNING=1 || echo RUNNING=0",
      "tail -n 40 " + log,
    ].join("\n");
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: (opts.wait ?? 2) + 30 });
    if (r.exitCode !== 0) throw new Error(opts.host + ": " + (r.stderr || r.stdout).trim());
    const [first, ...rest] = r.stdout.split("\n");
    return { name: opts.name, session: sess, running: first === "RUNNING=1", log: "~/.hyper-jobs/" + opts.name + ".log", tail: rest.join("\n") };
}
