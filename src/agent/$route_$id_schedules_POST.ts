/** Legacy recurring-schedule form adapter backed by unified cron triggers. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  const id = String(opts.params.id ?? "");
  const form = await opts.req.formData();
  const action = String(form.get("action") ?? "add");
  try {
    if (action === "add") {
      const prompt = String(form.get("text") ?? "").trim();
      const raw = String(form.get("expression") ?? form.get("every") ?? "0 9 * * *").trim();
      if (!prompt) throw new Error("Prompt is required");
      let expression = raw;
      if (!raw.includes(" ")) {
        const match = raw.match(/^(\d+)(m|h|d)$/i);
        if (!match) throw new Error("Use a five-field cron expression");
        const amount = Number(match[1]);
        const unit = String(match[2]).toLowerCase();
        const now = new Date();
        if (unit === "m" && amount > 0 && 60 % amount === 0) expression = `*/${amount} * * * *`;
        else if (unit === "h" && amount > 0 && 24 % amount === 0) expression = `${now.getUTCMinutes()} */${amount} * * *`;
        else if (unit === "d" && amount === 1) expression = `${now.getUTCMinutes()} ${now.getUTCHours()} * * *`;
        else throw new Error("This interval cannot be represented safely as cron; use a five-field expression");
      }
      const made = await ctx.fns.agent.cron({ id, expression, timezone: String(form.get("timezone") ?? "UTC"), prompt });
      if (form.get("now") === "1") await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET next_at=?,updated_at=? WHERE id=?", params: [Date.now(), Date.now(), made.id] });
    } else {
      const triggerId = String(form.get("name") ?? form.get("triggerId") ?? "");
      if (action === "run") await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET next_at=?,updated_at=? WHERE id=? AND agent_id=? AND kind='cron' AND status='active'", params: [Date.now(), Date.now(), triggerId, id] });
      else if (action === "delete") await ctx.fns.agent.cancelTrigger({ id, triggerId });
      else throw new Error("Legacy pause/resume is not supported; cancel and recreate the trigger");
    }
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: id, section: "automation", reason: "schedule-changed" });
    return new Response(null, { status: 204, headers: { "HX-Trigger": "agent-meta-refresh" } });
  } catch (error: any) {
    return new Response(String(error?.message ?? error), { status: 400 });
  }
}
