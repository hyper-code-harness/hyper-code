// Run a shell snippet in the agent's workspace. Secret references are resolved
// into child-process environment variables and redacted from captured output.
/**
 * Runs a shell command in the agent workspace, or on a remote SSH host over a persistent connection.
 *
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host).
 * @param opts.command Shell command to execute.
 * @param opts.cwd Working directory; relative to the workspace locally, remote path with host.
 * @param opts.env Additional environment variables.
 * @param opts.secrets Secret references exposed as environment variables; values are redacted from output.
 * @param opts.timeout Timeout in seconds.
 * @param opts.title With background — short label for the job; defaults to the first line of the command. Set by callers that wrap a command (background eval).
 * @param opts.background Run as a background job (jobs.start) and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: a command done by then returns its normal result, one still running keeps running as the job.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host). */
        host?: string;
        /** Shell command to execute. */
        command: string;
        /** Working directory relative to the workspace. */
        cwd?: string;
        /** Additional environment variables. */
        env?: Record<string, string>;
        /** Secret references (op://, env:// or secret://namespace/name) exposed as environment variables; values are redacted from output. */
        secrets?: Record<string, string>;
        /** Timeout in seconds. */
        timeout?: number;
        /** Run as a background job (jobs.start) and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: a command done by then returns its normal result, one still running keeps running as the job. @default false */
        background?: boolean | { afterMs?: number; wake?: string };
        /** With background — short label for the job; defaults to the first line of the command. Set by callers that wrap a command (background eval). */
        title?: string;
    },
): Promise<{ output: string; isError: boolean }> {
    if (opts.background) {
        const bg = typeof opts.background === "object" ? opts.background : {};
        const afterMs = Math.max(0, Math.min(600_000, Math.floor(bg.afterMs ?? 0)));
        // timeout kills the process; afterMs only decides how long this call blocks. The job is started at once
        // either way, so a command still running at afterMs simply goes on — the same process, not a restart.
        const job = await ctx.fns.jobs.start({
            command: opts.command, host: opts.host, cwd: opts.cwd, env: opts.env, secrets: opts.secrets,
            timeout: opts.timeout, title: opts.title, prompt: bg.wake, originToolCallId: (ctx as any).toolRun?.toolCallId, quietMs: afterMs,
        });
        if (afterMs > 0) {
            const waited = await waitFor(ctx, job.id, afterMs);
            if (waited.done) return await foreground(ctx, waited.job);
        }
        const after = afterMs > 0 ? `Still running after ${Math.round(afterMs / 1000)}s — moved to background job ${job.id}` : `Started background job ${job.id}`;
        return {
            output: `${after}${job.host ? ` on ${job.host}` : ""}: ${job.title}\nYou will get a message when it ends — do not wait or poll; end your turn or do other work. Output: ctx.fns.jobs.logs({ id: "${job.id}" }); stop: ctx.fns.jobs.cancel({ id: "${job.id}" }); everything running: ctx.fns.jobs.list({}).`,
            isError: false,
        };
    }
    const toolRun: types.tools.ToolRun | undefined = (ctx as any).toolRun;
    if (toolRun && opts.secrets) toolRun.secrets = opts.secrets;
    const secretEnv: Record<string, string> = {};
    const sensitive: string[] = [];

    for (const [name, ref] of Object.entries(opts.secrets ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid secret environment variable: ${name}`);
        if (!ref.startsWith("op://") && !ref.startsWith("env://") && !ref.startsWith("secret://")) {
            throw new Error(`secret ${name} must be an op://, env:// or secret:// reference`);
        }
        const value = await ctx.fns.secrets.get({ ref });
        if (!value) throw new Error(`secret ${name} could not be resolved`);
        secretEnv[name] = value;
        sensitive.push(value);
    }

    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.cwd });
    const result = at.host ? await remote(ctx, at.host, opts.command, at.path, { ...opts.env, ...secretEnv }, opts.timeout) : await ctx.fns.agent.executeBash({
        code: opts.command,
        cwd: opts.cwd,
        env: { ...opts.env, ...secretEnv },
        timeout: opts.timeout,
    });

    // Longer values first avoids partial masking when one secret prefixes another.
    for (const value of [...new Set(sensitive)].sort((a, b) => b.length - a.length)) {
        result.output = result.output.replaceAll(value, "[REDACTED]");
    }
    return result;
}

// Waits up to timeoutMs for the job this call just started. A job that ends here is recorded without a completion
// message: the caller returns its result in the foreground.
async function waitFor(ctx: Context, id: string, timeoutMs: number): Promise<{ done: boolean; job: types.jobs.Job }> {
    const end = Date.now() + Math.max(0, Math.min(600_000, Math.floor(timeoutMs)));
    for (let step = 100; ; step = Math.min(1000, step * 2)) {
        const job = await ctx.fns.jobs.get({ id: id });
        if (job.status !== "running") return { done: true, job };
        if (job.runner === "bash" || job.runner === "attached") {
            const attached = job.runner === "attached";
            const probe = await ctx.fns.jobs.bashProbe({
                jobId: job.id,
                host: attached ? null : job.host,
                backend: job.spec?.backend,
                ...(attached ? { alive: ((ctx.state as any).attachedJobs as Map<string, unknown> | undefined)?.has(job.id) ?? false } : {}),
            });
            if (probe.state === "done" || probe.state === "gone") {
                const row = ((await ctx.fns.procs.db.select({ sql: "SELECT spec, cancel_requested_at FROM jobs WHERE id = ?", params: [job.id] })) as any[])[0];
                const cancelled = row?.cancel_requested_at != null;
                const status = cancelled ? "cancelled" : probe.state === "gone" ? "lost" : probe.exitCode === 0 ? "succeeded" : "failed";
                const reason = cancelled ? "cancelled" : probe.state === "gone" ? "gone" : "exit";
                const tail = await ctx.fns.jobs.redact({ spec: row?.spec ?? {}, text: probe.tail });
                await ctx.fns.jobs.finish({ id: job.id, status, reason, exitCode: probe.exitCode, tail, bytes: probe.bytes, notify: false });
                return { done: true, job: await ctx.fns.jobs.get({ id: job.id }) };
            }
        }
        const left = end - Date.now();
        if (left <= 0) return { done: false, job };
        await Bun.sleep(Math.min(step, left));
    }
}

// A background call that ended within afterMs answers like a foreground one: output, or [exit N] + output.
async function foreground(ctx: Context, job: types.jobs.Job): Promise<{ output: string; isError: boolean }> {
    const log = await ctx.fns.jobs.logs({ id: job.id, offset: -REMOTE_MAX, limit: REMOTE_MAX }).catch(() => ({ text: job.result?.tail ?? "", bytes: 0 }));
    const text = (log.bytes > REMOTE_MAX ? `… [${log.bytes - REMOTE_MAX} bytes cut — ctx.fns.jobs.logs({ id: "${job.id}", offset: 0 })] …\n` : "") + log.text.trimEnd();
    if (job.status === "succeeded") return { output: text || "(no output)", isError: false };
    const head = job.status === "timeout" ? `[timed out — the command was killed]` : job.status === "failed" ? `[exit ${job.result?.exitCode}]` : `[${job.status}]`;
    return { output: text ? `${head}\n${text}` : head, isError: true };
}

// Remote branch: same output contract as agent.executeBash, transported by remote.exec.
// Output is capped (head + tail kept) so one noisy remote command cannot flood the transcript.
const REMOTE_MAX = 100_000;
function cap(text: string): string {
    if (text.length <= REMOTE_MAX) return text;
    const half = REMOTE_MAX / 2;
    return `${text.slice(0, half)}\n… [${text.length - REMOTE_MAX} chars cut — redirect to a file and read/grep it] …\n${text.slice(-half)}`;
}
async function remote(ctx: Context, host: string, command: string, cwd: string | undefined, env: Record<string, string>, timeout?: number): Promise<{ output: string; isError: boolean }> {
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const exports = Object.entries(env).map(([k, v]) => `export ${k}=${shq(v)}\n`).join("");
    const limit = timeout ?? 600;
    const r = await ctx.fns.remote.exec({ host, command: exports + command, cwd, timeout: limit });
    if (r.timedOut) return { output: cap(`[timed out after ${limit}s]\n${r.stdout}${r.stderr}`), isError: true };
    if (r.exitCode === 255 && !r.stdout) return { output: `[ssh ${host} failed]\n${r.stderr.trim()}\nCheck the host with ctx.fns.remote.status({ host: "${host}" }).`, isError: true };
    if (r.exitCode !== 0) return { output: cap(`[exit ${r.exitCode}]\n${r.stderr}\nstdout:\n${r.stdout}`), isError: true };
    return { output: cap(r.stdout || (r.stderr ? "(stderr)\n" + r.stderr : "(no output)")), isError: false };
}
