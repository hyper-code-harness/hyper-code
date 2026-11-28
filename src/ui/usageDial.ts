/**
 * Render one quiet subscription-quota indicator for the left Dock.
 *
 * The ring shows the highest recorded usage, remaining neutral below 100%.
 * Exhausted credentials or parked agents get a danger mark; threshold tones
 * from usageOverview do not turn ordinary consumption into an error.
 * Hover gives the selected account's percentage and reset time. A native
 * popover lists the same quota details for every supplied account on click.
 * Returns nothing when no snapshots exist; no credentials or provider I/O.
 *
 * @param opts.entries Cached, viewer-accessible quota rows from llm.usageOverview.
 * @param opts.now Current timestamp in milliseconds; defaults to Date.now().
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Rows produced by llm.usageOverview. */
        entries: Array<{
            provider: string;
            account: string;
            label: string;
            model?: string;
            usedPercent: number | null;
            resetsAt: number | null;
            planType: string | null;
            parkedAgents: number;
            tone: "neutral" | "warning" | "error";
        }>;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): string {
    const w = ctx.fns.w;
    const entries = opts.entries ?? [];
    if (!entries.length) return "";
    const now = opts.now ?? Date.now();
    const rows = entries.map((entry) => {
        const percent = entry.usedPercent != null && Number.isFinite(entry.usedPercent)
            ? Math.max(0, Math.min(100, entry.usedPercent)) : null;
        const blocked = entry.parkedAgents > 0 || (percent != null && percent >= 100);
        // Floor the display digit so 99.99% never claims that quota is exhausted.
        const used = percent == null ? "usage unavailable" : `${Math.floor(percent * 10) / 10}% used`;
        const status = entry.parkedAgents > 0
            ? `quota exhausted · ${entry.parkedAgents} agent(s) parked`
            : blocked ? "quota exhausted"
                : percent == null ? "no data yet" : `${Math.floor((100 - percent) * 10) / 10}% remaining`;
        const reset = entry.resetsAt == null ? "reset time unavailable"
            : entry.resetsAt <= now ? "reset due — awaiting fresh usage"
                : `resets in ${humanDelay(entry.resetsAt - now)} · ${new Date(entry.resetsAt).toLocaleString()}`;
        const label = `${entry.label}${entry.planType ? ` · ${entry.planType}` : ""}`;
        return { entry, percent, blocked, used, status, reset, label };
    });
    // Do not rely on caller ordering, or hide a parked account with unknown usage.
    const selected = [...rows].sort((a, b) => Number(b.blocked) - Number(a.blocked)
        || (b.percent ?? -1) - (a.percent ?? -1))[0]!;
    const title = [
        "Subscription quota",
        `${selected.blocked ? "blocked account" : "highest recorded usage"}: ${selected.label}`,
        selected.used, selected.status, selected.reset,
        "Click for all accounts",
    ].join(" · ");
    const id = "llm-usage-popup";
    const trigger = w.railItem({
        label: title,
        face: selected.percent == null
            ? w.icon({ name: selected.blocked ? "pause" : "question", size: 16 })
            : w.ring({ value: selected.percent, tone: selected.blocked ? "danger" : "neutral", size: 20, title }),
        dot: selected.blocked ? "error" : undefined,
        action: { popover: id },
        attrs: { "data-usage-indicator": true },
    });
    // Reset details must wrap: listRow.detail is deliberately one-line/ellipsized.
    const accounts = rows.map((row) => w.listSection({
        attrs: { "data-usage-account": true },
        rows: w.listRow({
            label: row.label,
            lead: ctx.fns.ui.modelLogo({ model: row.entry.model ?? `${row.entry.provider}:`, bare: true }),
            hint: row.used,
            dot: row.blocked ? "error" : undefined,
        }) + w.keyValue({ items: [
            { key: "Status", value: row.status },
            { key: "Reset", value: row.reset },
        ] }),
    })).join("");
    return w.popover({
        id, label: "Subscription quota", placement: "side", width: 320, trigger,
        body: w.list({ body: accounts + w.divider({})
            + w.listRow({ label: "LLM connections", icon: "plugs-connected", action: { href: "/llms" } }) }),
    });
}

function humanDelay(ms: number): string {
    const left = Math.max(0, ms);
    const minutes = Math.floor(left / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}d ${hours % 24}h`;
    if (hours >= 1) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}
