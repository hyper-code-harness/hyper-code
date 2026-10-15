/**
 * The compact-context form of a chat (optional focus instructions + Compact), shared by the header button and the panel.
 * @param opts.agentId Agent whose context is compacted.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose context is compacted. */
    agentId: string;
}): string {
    const id = encodeURIComponent(String(opts.agentId));
    return `<form hx-post="/agent/${id}/compact" hx-swap="none" hx-config='{"timeout":0}'><div class="text-sm font-medium">Compact context</div><textarea name="instructions" rows="3" placeholder="Optional focus instructions" class="mt-2 w-full rounded border border-ui-border bg-base-100 p-2 text-xs"></textarea>${ctx.fns.procs.ui.button({ action: "compact-context", label: "Compact", type: "submit", tone: "primary", class: "mt-2" })}</form>`;
}
