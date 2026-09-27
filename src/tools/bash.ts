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
    },
): Promise<{ output: string; isError: boolean }> {
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
