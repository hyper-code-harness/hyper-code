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
    const tone = status?.state === "available" ? "info" : status?.state === "dirty" || status?.state === "diverged" ? "warning" : "danger";
    const label = status?.message ?? "Check for Hyper updates";
    const text = status?.state === "available" ? String(status.behind || "!") : "!";
    // hx-swap outerHTML replaces this very link on every poll; hidden while Hyper is current (/dock/dock.js reads it for the gear's dot).
    return `<a id="hyper-update-badge" href="/update" hx-get="/update/status" hx-trigger="${status ? "every 15m" : "load, every 15m"}" hx-swap="outerHTML" aria-label="${Bun.escapeHTML(label)}" title="${Bun.escapeHTML(label)}"${visible ? "" : " hidden"}>${visible ? ctx.fns.w.badge({ text, tone }) : ""}</a>`;
}
