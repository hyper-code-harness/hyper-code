/** Renders trigger execution audit in the application popup. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  const agentId = String(opts.params.id ?? "");
  const triggerId = String(opts.params.triggerId ?? "");
  const esc = (value: any) => ctx.fns.procs.ui.escape({ text: value == null ? "" : String(value) });
  const trigger = (await ctx.fns.procs.db.select({ sql: `SELECT id,kind,prompt,config,timezone,mode,status,next_at AS "nextAt",timeout_at AS "timeoutAt",attempts,last_error AS "lastError",created_at AS "createdAt",finished_at AS "finishedAt" FROM agent_triggers WHERE id=? AND agent_id=?`, params: [triggerId, agentId] }))[0] as any;
  if (!trigger) return new Response("Trigger not found", { status: 404 });
  const runs = await ctx.fns.procs.db.select({ sql: `SELECT id,scheduled_at AS "scheduledAt",outcome,result,error,created_at AS "createdAt" FROM agent_trigger_runs WHERE trigger_id=? ORDER BY id DESC LIMIT 100`, params: [triggerId] }) as any[];
  const fmt = (value: any) => value == null ? "—" : new Date(Number(value)).toLocaleString();
  const json = (value: any) => { try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); } };
  const last = runs[0];
  const stats = ctx.fns.procs.ui.stats({ items: [
    { label: "Total runs", value: runs.length },
    { label: "Status", value: trigger.status, tone: trigger.status === "completed" ? "success" : trigger.status === "timed_out" || trigger.lastError ? "danger" : "info" },
    { label: "Last run", value: last ? fmt(last.createdAt) : "Never", sub: last?.outcome ?? "" },
    { label: "Attempts", value: trigger.attempts ?? 0 },
  ] });
  const rows = runs.map((run: any) => `<article class="rounded-lg border border-ui-border bg-base-100/45 p-3"><div class="flex items-center gap-2"><span class="badge badge-sm">${esc(run.outcome)}</span><span class="text-3xs text-faint">${esc(fmt(run.createdAt))}</span><span class="ml-auto font-mono text-micro text-faint">#${esc(run.id)}</span></div>${run.error ? `<pre class="mt-2 text-error">${esc(run.error)}</pre>` : ""}${run.result != null ? `<pre class="mt-2">${esc(json(run.result))}</pre>` : ""}<div class="mt-2 text-micro text-faint">scheduled ${esc(fmt(run.scheduledAt))}</div></article>`).join("");
  const html = `<section data-popup-content data-popup-title="Trigger audit" data-popup-kind="trigger-audit" class="space-y-4">${stats}<div><div class="text-3xs font-semibold uppercase tracking-wide text-faint">${esc(trigger.kind)} · ${esc(trigger.status)}</div><div class="mt-1 text-sm text-muted">${esc(trigger.prompt)}</div><div class="mt-1 font-mono text-micro text-faint">${esc(trigger.id)}</div></div>${trigger.lastError ? `<div class="rounded-lg bg-error/10 p-3 text-error">${esc(trigger.lastError)}</div>` : ""}<div><h3 class="mb-2 text-xs font-semibold">Run history</h3><div class="space-y-2">${rows || '<div class="text-faint">No runs yet.</div>'}</div></div></section>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
