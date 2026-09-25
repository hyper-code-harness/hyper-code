/**
 * Renders the Observed entities inspector section with last successful turn entity and fact outcome counters.
 *
 * Builds the Knowledge slot of the agent meta panel in the same style as Observed goals: a Track entities toggle (POST /knowledge/agent/:id/tracking), the mentions recorded by the last sidecar runs with matched/new/ambiguous badges linking to /knowledge/<Type>/<slug>, and the sidecar status line. Called by the core `ui.agentMetaSection` when the plugin is mounted; pure HTML, no data access.
 * @param opts.agent Live agent whose `scratchpad.knowledgeSidecar` and `knowledgeTrackingEnabled` are shown.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Live agent whose `scratchpad.knowledgeSidecar` and `knowledgeTrackingEnabled` are shown. */ agent: types.agent.Agent;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: String(s ?? "") });
    const agent: any = opts.agent;
    const id = encodeURIComponent(agent.id);
    const statusBadge = ctx.fns.ui.statusBadge ?? ((o: any) => `<span class="badge badge-sm">${esc(o.label)}</span>`);
    const inspectorSection = ctx.fns.ui.inspectorSection ?? ((o: any) => `<details ${o.open ? "open" : ""}><summary>${esc(o.title)}</summary><div>${o.html}</div></details>`);
    const enabled = agent.scratchpad?.knowledgeTrackingEnabled === true;
    const preview = agent.scratchpad?.knowledgeSidecar ?? null;
    const mentions: any[] = Array.isArray(preview?.mentions) ? preview.mentions : [];
    const toggle = `<form hx-post="/knowledge/agent/${id}/tracking" hx-swap="none" hx-trigger="change" class="mb-3">${ctx.fns.ui.toggle({ name: "enabled", enabled, label: "Track entities", hint: "Record people, organizations and products mentioned in this chat into Knowledge" })}</form>`;
    const tone = (status: string) => status === "matched" ? "success" : status === "new" ? "info" : "warning";
    const icon = (type: string) => ({ Person: "ph-user", Organization: "ph-buildings", Product: "ph-package", Concept: "ph-lightbulb", Standard: "ph-seal-check" } as Record<string, string>)[type] ?? "ph-cube";
    const href = (entityId: string) => `/knowledge/${String(entityId).split("/").map(encodeURIComponent).join("/")}`;
    const render = (m: any) => {
        const title = m.entityId ? `<a href="${href(m.entityId)}" class="hover:underline">${esc(m.name)}</a>` : esc(m.name);
        const alt = m.status === "ambiguous" && Array.isArray(m.candidates) && m.candidates.length
            ? `<div class="mt-1 text-3xs leading-4 text-faint">Could be: ${m.candidates.map((c: any) => `<a href="${href(c.id)}" class="hover:underline">${esc(c.title ?? c.id)}</a>`).join(", ")}</div>` : "";
        const evidence = m.evidence ? `<div class="mt-1 truncate text-3xs leading-4 text-faint" title="${esc(m.evidence)}">“${esc(String(m.evidence).slice(0, 120))}”</div>` : "";
        const source = Number.isSafeInteger(m.sourceMessageIdx) && m.sourceMessageIdx >= 0 ? `<a class="mt-1 block text-2xs text-primary underline" href="/agent/${id}/message/${m.sourceMessageIdx}">Source message ${m.sourceMessageIdx}</a>` : "";
        return `<li class="rounded-lg border border-ui-border bg-base-100/35 px-2.5 py-2"><div class="flex items-start gap-2"><i class="ph ${icon(m.type)} mt-0.5 text-faint" title="${esc(m.type)}"></i><div class="min-w-0 flex-1 text-xs leading-5 text-muted">${title}</div>${statusBadge({ label: String(m.status ?? "new"), tone: tone(String(m.status)) })}</div>${alt}${evidence}${source}</li>`;
    };
    const turn = preview?.lastTurn;
    const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const summary = turn ? `<div class="mb-3 rounded-lg border border-ui-border px-2.5 py-2 text-xs leading-5"><strong>Last successful turn · message ${count(turn.sourceMessageIdx)}</strong><p>Entities: ${count(turn.matched)} matched · ${count(turn.created)} new · ${count(turn.skippedMentions)} skipped (ambiguous identity)</p><p>Facts: ${count(turn.facts?.added)} added · ${count(turn.facts?.changed)} changed · ${count(turn.facts?.noop)} no-op · ${count(turn.facts?.conflict)} conflict · ${count(turn.facts?.skipped)} skipped</p><p class="text-3xs text-faint">Submitted fact operations only; entity creation fields are excluded. No-op: value already present. Conflict: existing value preserved. Skipped facts: ambiguous identity or unresolved relation target. Counts cover the last successful batch, not all observations below.</p></div>` : "";
    const sorted = [...mentions].sort((a, b) => Number(b?.sourceMessageIdx ?? 0) - Number(a?.sourceMessageIdx ?? 0));
    const rows = sorted.length ? sorted.slice(0, 30).map(render).join("") : `<li class="rounded-lg border border-dashed border-ui-border px-2.5 py-3 text-xs leading-5 text-faint">No entities observed yet. Send a message after enabling tracking.</li>`;
    const state = !enabled
        ? '<p class="mt-2 text-3xs text-faint">Tracking is off for this agent.</p>'
        : preview?.status === "error"
            ? `<p class="mt-2 text-3xs leading-4 text-error">Sidecar failed: ${esc(preview.error ?? "unknown error")}</p>`
            : preview?.status === "ready"
                ? `<p class="mt-2 text-3xs text-faint">Observed from message ${Number(preview.sourceMessageIdx ?? 0)}${preview.sidecarId ? ` · sidecar ${esc(preview.sidecarId)}` : ""} · <a href="/knowledge" class="hover:underline">open Knowledge</a></p>`
                : '<p class="mt-2 text-3xs text-faint">Matched and new entities are written to Knowledge with provenance; ambiguous ones are only listed.</p>';
    return inspectorSection({ title: "Observed entities", icon: "graph", badge: statusBadge({ label: enabled ? String(mentions.length) : "off", tone: enabled && mentions.length ? "info" : "neutral" }), html: `${toggle}${summary}<ol class="space-y-2">${rows}</ol>${state}`, collapsible: true, open: enabled });
}
