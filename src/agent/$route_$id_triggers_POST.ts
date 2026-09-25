/** Creates, cancels, or immediately fires unified agent triggers from the inspector. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  const id = String(opts.params.id ?? "");
  const form = await opts.req.formData();
  const action = String(form.get("action") ?? "");
  try {
    if (action === "wake") {
      const minutes = Math.max(1, Math.min(10080, Number(form.get("minutes") ?? 5)));
      await ctx.fns.agent.wake({ id, inMs: minutes * 60_000, prompt: String(form.get("prompt") ?? "Continue scheduled work") });
    } else if (action === "cron") {
      await ctx.fns.agent.cron({ id, expression: String(form.get("expression") ?? "0 9 * * *"), timezone: String(form.get("timezone") ?? "UTC"), prompt: String(form.get("prompt") ?? "").trim() });
    } else if (action === "watch") {
      const predicate = String(form.get("predicate") ?? "file.exists") as "file.exists" | "db.rows" | "http.ok" | "runtime.fn";
      const value = String(form.get("value") ?? "").trim();
      const predicateOpts: Record<string, any> = predicate === "file.exists" ? { path: value } : predicate === "http.ok" ? { url: value } : predicate === "db.rows" ? { sql: value, params: [] } : { name: value, args: {} };
      const timeoutMinutes = Number(form.get("timeoutMinutes") ?? 0);
      await ctx.fns.agent.watch({ id, predicate, opts: predicateOpts, prompt: String(form.get("prompt") ?? "Condition met").trim(), everyMs: Math.max(5000, Number(form.get("everySeconds") ?? 60) * 1000), ...(timeoutMinutes > 0 ? { timeoutMs: timeoutMinutes * 60_000 } : {}), mode: String(form.get("mode") ?? "once") === "edge" ? "edge" : "once", ...(String(form.get("onTimeoutPrompt") ?? "").trim() ? { onTimeoutPrompt: String(form.get("onTimeoutPrompt")) } : {}) });
    } else if (action === "cancel") {
      await ctx.fns.agent.cancelTrigger({ id, triggerId: String(form.get("triggerId") ?? "") });
    } else if (action === "cancelAll") {
      await ctx.fns.agent.cancelAllTriggers({ id });
    } else if (action === "run") {
      const triggerId = String(form.get("triggerId") ?? "");
      await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET next_at=?, updated_at=? WHERE id=? AND agent_id=? AND status='active'", params: [Date.now(), Date.now(), triggerId, id] });
      ctx.fns.agent.wakeWorker({});
    } else throw new Error("Unsupported trigger action");
    ctx.fns.events.refreshAgentMeta({ agentId: id, section: "automation", reason: "trigger-changed" });
    return new Response(null, { status: 204, headers: { "HX-Trigger": "agent-meta-refresh" } });
  } catch (error: any) {
    return new Response(String(error?.message ?? error), { status: 400 });
  }
}
