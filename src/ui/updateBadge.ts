/**
 * Renders the self-updater status badge in the left navigation rail
 *
 * Returns a stable HTMX region that periodically checks for a fetched git update and shows a muted warning only when action is available or blocked.
 * @param opts.status Optional resolved update status; omit for the initial lazy-loading shell.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional resolved update status; omit for the initial lazy-loading shell. */
        status?: { state: string; behind: number; message: string };
    },
): Promise<string> {
    const status = opts.status;
    const visible = !!status && status.state !== "current";
    const tone = status?.state === "available" ? "bg-info/15 text-info" : status?.state === "dirty" || status?.state === "diverged" ? "bg-warning/15 text-warning" : "bg-error/15 text-error";
    const label = status?.message ?? "Check for Hyper updates";
    const text = status?.state === "available" ? String(status.behind || "!") : "!";
    return `<a id="hyper-update-badge" href="/update" hx-get="/update/status" hx-trigger="${status ? "every 15m" : "load, every 15m"}" hx-swap="outerHTML" aria-label="${Bun.escapeHTML(label)}" title="${Bun.escapeHTML(label)}" class="mt-1 size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone}" style="display:${visible ? "flex" : "none"}">${visible ? Bun.escapeHTML(text) : ""}</a>`;
}
