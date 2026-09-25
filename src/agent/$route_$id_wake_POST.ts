/** Legacy wake-up form adapter backed by unified agent triggers. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  const id = String(opts.params.id ?? "");
  const form = await opts.req.formData();
  try {
    if (String(form.get("action") ?? "set") === "cancel") {
      const active = await ctx.fns.agent.triggers({ id, status: "active" });
      for (const trigger of active.filter((item: any) => item.kind === "at")) await ctx.fns.agent.cancelTrigger({ id, triggerId: String(trigger.id) });
    } else {
      const raw = form.get("preset") ?? form.get("minutes") ?? 5;
      const minutes = Math.max(1, Math.min(10080, Number(raw)));
      await ctx.fns.agent.wake({ id, inMs: minutes * 60_000, prompt: String(form.get("reason") ?? "Continue scheduled work") });
    }
    ctx.fns.events.refreshAgentMeta({ agentId: id, section: "automation", reason: "wake-changed" });
    return new Response(null, { status: 204, headers: { "HX-Trigger": "agent-meta-refresh" } });
  } catch (error: any) {
    return new Response(String(error?.message ?? error), { status: 400 });
  }
}
