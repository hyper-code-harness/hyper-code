/**
 * Starts a shell command as a detached tmux session for a background job, locally or on an SSH host
 *
 * Bash runner of the jobs table. The command runs in tmux session hj-<jobId> with its output in
 * ~/.hyper-jobs/<jobId>/out.log and its exit code written to ~/.hyper-jobs/<jobId>/exit when it ends, so the process
 * survives a Hyper restart and jobs.poll can still collect it. The launcher script carries env and secret values in
 * a 0600 file that deletes itself as its first action; tmux and ps only ever see its path.
 * @param opts.jobId Job id; letters, digits, dash and underscore.
 * @param opts.host SSH alias, or null for this machine.
 * @param opts.command Shell source to run via bash.
 * @param opts.cwd Absolute (or ~/) working directory.
 * @param opts.env Environment variables exported before the command, secrets included.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Job id; letters, digits, dash and underscore. */
        jobId: string;
        /** SSH alias, or null for this machine. */
        host: string | null;
        /** Shell source to run via bash. */
        command: string;
        /** Absolute (or ~/) working directory. */
        cwd?: string;
        /** Environment variables exported before the command, secrets included. */
        env?: Record<string, string>;
        /** tmux session (default) or a transient hyperd unit named after the job (local only). @default "tmux" */
        backend?: "tmux" | "hyperd";
    },
): Promise<{ ok: boolean; error?: string }> {
    if (!/^[A-Za-z0-9_-]+$/.test(opts.jobId)) throw new Error("jobs.bashStart: invalid job id " + opts.jobId);
    if (opts.backend === "hyperd") {
        if (opts.host) return { ok: false, error: "hyperd backend runs local jobs only" };
        try {
            await ctx.fns.hyperd.ensure({});
            // env (secrets included) goes to the holder once and is never written to the unit spec
            await ctx.fns.hyperd.run({ name: opts.jobId, kind: "task", cmd: ["bash", "-c", ctx.fns.remote.shellPrelude({}) + opts.command], cwd: opts.cwd, env: opts.env, owner: "job:" + opts.jobId });
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: String(error?.message ?? error) };
        }
    }
    const q = (s: string) => ctx.fns.remote.quote({ value: s });
    const dir = `$HOME/.hyper-jobs/${opts.jobId}`;
    const exports = Object.entries(opts.env ?? {}).map(([k, v]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error("jobs.bashStart: invalid env name " + k);
        return `export ${k}=${q(v)}\n`;
    }).join("");
    const cd = opts.cwd ? `cd ${ctx.fns.remote.quote({ value: opts.cwd, path: true })} || { echo 'cd failed: ${opts.cwd.replaceAll("'", "")}'; echo 1 > "$JOB_DIR/exit"; exit 1; }\n` : "";
    // rm "$0" first: bash keeps reading the unlinked file through its open descriptor,
    // so env and secret values leave the disk the moment the job starts.
    const launcher = `rm -f "$0"\nJOB_DIR="${dir}"\n${ctx.fns.remote.shellPrelude({})}${exports}${cd}( ${opts.command}\n)\ncode=$?\necho "$code" > "$JOB_DIR/exit.tmp" && mv "$JOB_DIR/exit.tmp" "$JOB_DIR/exit"\n`;
    const script = [
        "command -v tmux >/dev/null || { echo 'tmux is not installed' >&2; exit 3; }",
        `mkdir -p "${dir}" && chmod 700 "$HOME/.hyper-jobs" "${dir}" || exit 1`,
        `( umask 077; cat > "${dir}/run.sh" ) || exit 1`,
        // A tmux server whose last session just ended exits while a new client attaches ("server exited
        // unexpectedly"); the next attempt starts a fresh server, so retry a few times before giving up.
        `started=; for attempt in 1 2 3; do tmux new-session -d -s ${q("hj-" + opts.jobId)} ${q(`bash "${dir}/run.sh" > "${dir}/out.log" 2>&1`)} && { started=1; break; }; tmux has-session -t ${q("hj-" + opts.jobId)} 2>/dev/null && { started=1; break; }; sleep 0.2; done`,
        `[ -n "$started" ] || { rm -f "${dir}/run.sh"; echo 'tmux could not start the job' >&2; exit 6; }`,
        "echo STARTED",
    ].join("\n");
    const r = await ctx.fns.jobs.sh({ host: opts.host, script, stdin: launcher, timeout: 30 });
    if (r.unreachable) return { ok: false, error: `host ${opts.host} unreachable: ${r.stderr.trim()}` };
    if (r.exitCode !== 0 || !r.stdout.includes("STARTED")) return { ok: false, error: (r.stderr || r.stdout).trim() || `exit ${r.exitCode}` };
    return { ok: true };
}
