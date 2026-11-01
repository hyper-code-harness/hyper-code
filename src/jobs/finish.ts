/**
 * Records the end of a background job and messages its agent, both in one transaction
 *
 * Internal step of jobs.poll and jobs.cancel. Moves a running job to its final status exactly once (compare-and-set
 * on status) and delivers the completion message through agent.deliver with key job:<id>:end, so a crash or a second
 * poller can neither lose nor double the message. Completion wakes use a 2 s batch window, so jobs that end close
 * together reach the agent in one turn.
 * @param opts.id Job id.
 * @param opts.status Final status.
 * @param opts.reason Short machine reason: exit, timeout, cancelled, gone.
 * @param opts.exitCode Process exit code when known.
 * @param opts.tail Last output bytes (already redacted).
 * @param opts.bytes Total output size in bytes.
 * @param opts.notify Send the completion message. @default true
 * @param opts.now Timestamp in ms.
 * @param opts.alsoFinishing Other job ids being finished in the same pass; not counted as still running.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Job id. */
        id: string;
        /** Final status. */
        status: "succeeded" | "failed" | "cancelled" | "timeout" | "lost";
        /** Short machine reason: exit, timeout, cancelled, gone. */
        reason: string;
        /** Process exit code when known. */
        exitCode?: number | null;
        /** Last output bytes (already redacted). */
        tail?: string;
        /** Total output size in bytes. */
        bytes?: number;
        /** Send the completion message. @default true */
        notify?: boolean;
        /** Timestamp in ms. */
        now?: number;
        /** Other job ids being finished in the same pass; not counted as still running. */
        alsoFinishing?: string[];
    },
): Promise<{ finished: boolean }> {
    const row = (await ctx.fns.procs.db.select({ sql: "SELECT * FROM jobs WHERE id = ?", params: [opts.id] }) as any[])[0];
    if (!row || row.status !== "running") return { finished: false };
    ((ctx.state as any).attachedJobs as Map<string, unknown> | undefined)?.delete(opts.id);
    const now = Math.floor(opts.now ?? Date.now());
    const spec = typeof row.spec === "string" ? JSON.parse(row.spec) : row.spec ?? {};
    const ms = now - Number(row.started_at ?? row.created_at);
    const result = { exitCode: opts.exitCode ?? null, ms, tail: (opts.tail ?? "").slice(-4000), bytes: opts.bytes ?? 0 };
    const finalize = async () => (await ctx.fns.procs.db.run({
        sql: "UPDATE jobs SET status = ?, outcome_reason = ?, result = ?::jsonb, finished_at = ?, next_at = NULL, lease_token = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
        params: [opts.status, opts.reason, JSON.stringify(result), now, now, opts.id],
    })).changes > 0;
    // The chat input's jobs badge is a live region on the agent's topic. Signal only AFTER the write is committed:
    // finalize runs inside agent.deliver's transaction, and a browser re-fetching before commit sees the job running.
    const changed = () => ctx.fns.procs.events.refresh({ topic: `agent:${row.agent_id}`, reason: "job-end" });

    if (opts.notify === false) {
        const finished = await finalize();
        if (finished) changed();
        if (finished) ctx.fns.events.refreshAgentMeta({ agentId: String(row.agent_id), section: "automation", reason: "job-end" });
        return { finished };
    }

    const secs = ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000));
    const label = `Background job ${opts.id} ${opts.status === "succeeded" ? "finished" : opts.status} (${opts.reason === "exit" ? `exit ${opts.exitCode}` : opts.reason}) after ${secs}s${spec.host ? ` on ${spec.host}` : ""}: ${spec.title}`;
    const tail = result.tail.trimEnd();
    const lines = [label];
    {
        lines.push(tail ? `Output tail (${result.bytes} bytes total):\n${tail}` : "Output: none (the command printed nothing).");
        if (result.bytes > result.tail.length) lines.push(`Full output: await ctx.fns.jobs.logs({ id: "${opts.id}" })`);
    }
    if (row.prompt) lines.push(`Your instruction for this moment: ${row.prompt}`);
    const running = Number(((await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int AS n FROM jobs WHERE agent_id = ? AND kind = 'exec' AND status = 'running' AND NOT (id = ANY(string_to_array(?, ',')))", params: [row.agent_id, [opts.id, ...(opts.alsoFinishing ?? [])].join(",")] })) as any[])[0]?.n ?? 0);
    // only commands: a pending agent.wake / cron / watch is also a running row, but nothing is executing
    if (running) lines.push(`${running} other job(s) still running — they will report when done.`);

    const delivered = await ctx.fns.agent.deliver({
        to: String(row.agent_id),
        type: "job",
        text: lines.join("\n"),
        key: `job:${opts.id}:end`,
        source: "job",
        event: { type: "job_end", jobId: opts.id, status: opts.status, reason: opts.reason, exitCode: result.exitCode, ms, title: spec.title, toolCallId: row.origin_tool_call_id ?? null },
        section: "automation",
        wake: "batch",
        windowMs: 2000,
        now,
        before: finalize,
    });
    if (delivered.delivered) changed();
    return { finished: delivered.delivered };
}
