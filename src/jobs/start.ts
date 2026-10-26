/**
 * Starts a background shell command that messages the agent when it ends; the bash tool's `background` option calls it
 *
 * Agents use the bash tool with `background` rather than calling this directly. Returns at once with the job id. The
 * command runs in a detached tmux session on this machine or an SSH host, survives a Hyper restart, and when it
 * exits the agent receives ONE inbox message with the exit code, duration and the output tail; several jobs
 * finishing close together are delivered in one wake-up. Read the full output with jobs.logs, stop it with
 * jobs.cancel, see what is running with jobs.list. The bash tool's `background: true` calls this.
 * @param opts.command Shell source to run.
 * @param opts.host SSH alias from ~/.ssh/config or "local"; omitted means the agent workspace host.
 * @param opts.cwd Working directory; relative paths resolve against the workspace.
 * @param opts.env Extra environment variables.
 * @param opts.secrets Secret references exposed as environment variables; values are redacted from what the agent reads.
 * @param opts.timeout Seconds after which a still-running job is stopped and reported as timeout. @default 86400
 * @param opts.title Short human label; defaults to the first line of the command.
 * @param opts.prompt Extra instruction appended to the completion message, e.g. "if green, deploy".
 * @param opts.agentId Agent to notify; defaults to the calling agent.
 * @param opts.originToolCallId Tool call that started the job, for the UI.
 * @param opts.quietMs Do not probe or report the job for this long (capped at its deadline): the caller is still waiting for it in the foreground. @default 0 @minimum 0
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Shell source to run. */
        command?: string;
        /** SSH alias from ~/.ssh/config or "local"; omitted means the agent workspace host. */
        host?: string;
        /** Working directory; relative paths resolve against the workspace. */
        cwd?: string;
        /** Extra environment variables. */
        env?: Record<string, string>;
        /** Secret references (op://, env://, secret://ns/name) exposed as environment variables; values are redacted from what the agent reads. */
        secrets?: Record<string, string>;
        /** Seconds after which a still-running job is stopped and reported as timeout. @default 86400 @minimum 1 @maximum 2592000 */
        timeout?: number;
        /** Short human label; defaults to the first line of the command. */
        title?: string;
        /** Extra instruction appended to the completion message, e.g. "if green, deploy". */
        prompt?: string;
        /** Agent to notify; defaults to the calling agent. */
        agentId?: string;
        /** Tool call that started the job, for the UI. */
        originToolCallId?: string;
        /** Do not probe or report the job for this long (capped at its deadline): the caller is still waiting for it in the foreground. @default 0 @minimum 0 */
        quietMs?: number;
    },
): Promise<types.jobs.Job> {
    const agentId = opts.agentId ?? session?.agentId ?? (session as any)?.agent?.id;
    if (!agentId) throw new Error("jobs.start: no agent to notify (pass agentId)");
    const runner = "bash";
    const now = Date.now();
    const id = "j" + Bun.randomUUIDv7().replaceAll("-", "").slice(-10);
    const owner = (await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [agentId] }) as any[])[0];
    if (!owner) throw new Error("jobs.start: unknown agent " + agentId);

    let spec: Record<string, any>;
    let deadline: number;
    let nextAt: number;
    {
        const command = String(opts.command ?? "");
        if (!command.trim()) throw new Error("jobs.start: command is required");
        for (const [name, ref] of Object.entries(opts.secrets ?? {})) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid secret environment variable: ${name}`);
            if (!/^(op|env|secret):\/\//.test(ref)) throw new Error(`secret ${name} must be an op://, env:// or secret:// reference`);
        }
        // Workspace callers: the agent's own workspace, like the bash tool.
        const wsCtx: any = session?.agentId === agentId || !(ctx.state as any).agent?.[agentId] ? ctx : Object.assign(Object.create(ctx), { session: ctx.fns.session.forAgent({ agent: (ctx.state as any).agent[agentId] }) });
        const at = wsCtx.fns.workspace.target({ host: opts.host, path: opts.cwd });
        const title = (opts.title ?? command.split("\n").find((l: string) => l.trim()) ?? command).trim().slice(0, 120);
        // Only references are stored: values are resolved at launch and again for redaction.
        // Local jobs may run under hyperd (setting jobs.backend); SSH hosts always use tmux.
        const backend = !at.host && (await ctx.fns.settings.getString({ module: "jobs", scopeType: "global", key: "backend", fallback: "tmux" })) === "hyperd" ? "hyperd" : "tmux";
        spec = { title, command, host: at.host, cwd: at.path, env: opts.env ?? {}, secrets: opts.secrets ?? {}, backend };
        deadline = now + Math.max(1, Math.min(2_592_000, opts.timeout ?? 86_400)) * 1000;
        nextAt = now + Math.max(1000, Math.min(Math.floor(opts.quietMs ?? 0), deadline - now));
    }

    await ctx.fns.procs.db.run({
        sql: `INSERT INTO jobs (id, kind, runner, spec, state, status, owner_id, created_by, agent_id, prompt, origin_tool_call_id, execution_id, next_at, created_at, started_at, deadline_at, updated_at)
              VALUES (?, 'exec', ?, ?::jsonb, '{}'::jsonb, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, runner, JSON.stringify(spec), owner.created_by ?? null, session?.user?.id ?? (session?.agentId ? "agent:" + session.agentId : null), agentId, opts.prompt ?? null, opts.originToolCallId ?? null, id, nextAt, now, now, deadline, now],
    });

    {
        let started: { ok: boolean; error?: string };
        try {
            const env: Record<string, string> = { ...(spec.env as Record<string, string>) };
            for (const [name, ref] of Object.entries(spec.secrets as Record<string, string>)) {
                const value = await ctx.fns.secrets.get({ ref });
                if (!value) throw new Error(`secret ${name} could not be resolved`);
                env[name] = value;
            }
            started = await ctx.fns.jobs.bashStart({ jobId: id, host: spec.host, command: spec.command, cwd: spec.cwd, env, backend: spec.backend });
        } catch (error: any) {
            started = { ok: false, error: String(error?.message ?? error) };
        }
        if (!started.ok) {
            // Never started: the caller learns it right here, no inbox message.
            await ctx.fns.procs.db.run({
                sql: "UPDATE jobs SET status = 'failed', outcome_reason = 'start', result = ?::jsonb, finished_at = ?, next_at = NULL, updated_at = ? WHERE id = ?",
                params: [JSON.stringify({ error: started.error }), Date.now(), Date.now(), id],
            });
            throw new Error(`jobs.start: could not start: ${started.error}`);
        }
    }
    ctx.fns.events.refreshAgentMeta({ agentId, section: "automation", reason: "job-start" });
    // the chat header's "N jobs" badge is a live region on the agent's topic
    ctx.fns.procs.events.refresh({ topic: `agent:${agentId}`, reason: "job-start" });
    ctx.fns.agent.wakeWorker({});
    return await ctx.fns.jobs.get({ id });
}
