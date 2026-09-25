/**
 * Lists recurring agent schedules from the unified trigger engine.
 *
 * Compatibility adapter for the former cron-task-backed Agent schedules UI. New code should call `agent.triggers` and filter `kind === "cron"`.
 * @param opts.agentId Agent whose recurring schedules are listed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** Agent whose recurring schedules are listed. */
  agentId: string;
}): Promise<any[]> {
  const rows = await ctx.fns.agent.triggers({ id: opts.agentId, status: "all" });
  return rows.filter((row: any) => row.kind === "cron").map((row: any) => {
    const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config ?? {};
    return {
      name: row.id,
      fn: "agent.injectScheduledPrompt",
      args: { agentId: opts.agentId, text: row.prompt, scheduleId: row.id },
      scheduleType: "cron",
      expression: config.expression,
      timezone: row.timezone,
      nextRunAt: row.nextAt,
      enabled: row.status === "active",
      state: row.status === "checking" ? "running" : "idle",
    };
  });
}
