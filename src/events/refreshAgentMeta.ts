// The meta panel is redrawn per section, over RPC: this emits a push event,
// and the client ($script_meta.js) answers by calling ui.agentMetaSectionHtml
// for exactly that section and swapping it into its slot. Without a section
// the whole panel is stale — "all" redraws every slot.
/**
 * Requests a redraw of one agent meta panel section.
 * @param opts.agentId Target agent identifier.
 * @param opts.section Which panel section changed; "all" redraws every section.
 * @param opts.reason Human-readable refresh reason, for tracing.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Target agent identifier. */
    agentId: string;
    /** Which panel section changed. @default "all" */
    section?: "goal" | "knowledge" | "automation" | "wake" | "team" | "plan" | "all";
    /** Human-readable refresh reason, for tracing. */
    reason?: string;
}): void {
    const section = opts.section ?? "all";
    // Inspector pages (agent.inspector, `@live agent-meta`) on a canvas tab or in a browser tab re-fetch themselves.
    ctx.fns.procs.events.refresh({ topic: "agent-meta", reason: opts.reason ?? "meta" });
    ctx.fns.procs.events.emit({ event: { type: "ui.metaSection", agentId: opts.agentId, section, reason: opts.reason ?? "meta" } });
}
