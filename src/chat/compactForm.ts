/**
 * Render the shared form for queuing context compaction with optional focus instructions after the current turn.
 * @param opts.agentId Agent whose context is compacted.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose context is compacted. */
    agentId: string;
}): string {
    const id = encodeURIComponent(String(opts.agentId));
    return `<form hx-post="/agent/${id}/compact" hx-swap="none" hx-config='{"timeout":0}'><div class="text-sm font-medium">Compact context</div><textarea name="instructions" rows="3" aria-label="Optional focus instructions" placeholder="Optional focus instructions" class="mt-2 w-full rounded border border-ui-border bg-base-100 p-2 text-xs"></textarea><p class="mt-2 text-xs text-ui-muted">Focus is optional; leave blank for the default summary. Compaction is queued after the current turn and does not interrupt it.</p>${`<div class="mt-2">${ctx.fns.w.button({ label: "Queue compaction", tone: "primary", size: "md", submit: true, marks: { action: "compact-context" } })}</div>`}</form>`;
}
