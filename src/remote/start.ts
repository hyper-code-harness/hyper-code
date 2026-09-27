/**
 * Starts a long-running command on an SSH server in a detached tmux session with a log file.
 *
 * Use for servers, watchers, builds and anything that must outlive the call or the SSH connection. Output goes to ~/.hyper-jobs/<name>.log on the remote host; read it with remote.logs, stop with remote.stop, list with remote.jobs. The user can watch live with `ssh <host> -t tmux attach -t hyper-<name>`. Fails if a job with the same name is running unless restart is set. Requires tmux on the remote host.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.name Job name; becomes the tmux session hyper-<name>. Letters, digits, dash and underscore.
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
        /** Job name; becomes the tmux session hyper-<name>. Letters, digits, dash and underscore. */
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
    // Dots and colons are tmux target separators; keep names to a safe alphabet.
    if (!/^[A-Za-z0-9_-]+$/.test(opts.name)) throw new Error("invalid job name (letters, digits, - and _): " + opts.name);
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const sess = "hyper-" + opts.name;
    // "=name" makes tmux match the session name exactly, not as a prefix.
    const target = "=" + sess;
    const dir = "$HOME/.hyper-jobs";
    const log = dir + "/" + opts.name + ".log";
    const job = dir + "/" + opts.name + ".sh";
    const lock = dir + "/" + opts.name + ".lock";
    const exports = Object.entries(opts.env ?? {}).map(([k, v]) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error("invalid env name: " + k); return "export " + k + "=" + shq(v) + "\n"; }).join("");
    const cd = opts.cwd ? "cd " + ctx.fns.remote.quote({ value: opts.cwd, path: true }) + " || exit 1\n" : "";
    // The job (with its env values) is written to a 0600 file through stdin; tmux
    // only ever sees that file's path, so secrets never reach ps or tmux metadata.
    const body = "#!/usr/bin/env bash\n" + ctx.fns.remote.shellPrelude({}) + exports + cd + "( " + opts.command + "\n)\necho \"[exit $?] $(date)\"\n";
    const script = [
      "command -v tmux >/dev/null || { echo 'tmux is not installed' >&2; exit 3; }",
      'mkdir -p "' + dir + '" && chmod 700 "' + dir + '"',
      // Serialize concurrent starts of the same job name.
      'i=0; until mkdir "' + lock + '" 2>/dev/null; do i=$((i+1)); [ $i -ge 100 ] && { echo "job ' + opts.name + ' is being started by another caller" >&2; exit 5; }; sleep 0.05; done',
      'trap \'rmdir "' + lock + '" 2>/dev/null\' EXIT',
      opts.restart
        ? "tmux kill-session -t " + shq(target) + " 2>/dev/null; sleep 0.3"
        : "tmux has-session -t " + shq(target) + " 2>/dev/null && { echo 'job " + opts.name + " is already running (pass restart: true)' >&2; exit 4; }",
      '( umask 077; cat > "' + job + '" ) || exit 1',
      'chmod 700 "' + job + '"',
      // Create the session first; only a started job may truncate its log.
      "tmux new-session -d -s " + shq(sess) + " " + shq("bash " + '"' + job + '"' + ' >> "' + log + '" 2>&1') + " || { echo 'tmux could not start the job' >&2; exit 6; }",
      "sleep " + Math.max(0, Math.min(60, opts.wait ?? 2)),
      "tmux has-session -t " + shq(target) + " 2>/dev/null && echo RUNNING=1 || echo RUNNING=0",
      'tail -n 40 "' + log + '"',
    ].join("\n");
    // Truncate the previous log only after the lock is held: the job appends to it.
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script.replace('( umask 077; cat > "' + job + '" ) || exit 1', ': > "' + log + '"\n( umask 077; cat > "' + job + '" ) || exit 1'), stdin: body, timeout: (opts.wait ?? 2) + 30 });
    if (r.exitCode !== 0) throw new Error(opts.host + ": " + (r.stderr || r.stdout).trim());
    const [first, ...rest] = r.stdout.split("\n");
    return { name: opts.name, session: sess, running: first === "RUNNING=1", log: "~/.hyper-jobs/" + opts.name + ".log", tail: rest.join("\n") };
}
