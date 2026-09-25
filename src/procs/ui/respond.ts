/**
 * Builds an htmx HTML response with out-of-band updates, a toast and client events
 *
 * Use from POST/PUT/DELETE route handlers instead of hand-writing `HX-*` headers and
 * `hx-swap-oob` markup. The main `html` is swapped into the requesting element's
 * target; each `oob` entry replaces the element with that id anywhere on the page;
 * `toast` raises the shared corner notification; `trigger` fires DOM events such as
 * `nav-refresh`; `redirect` performs a full navigation and `location` an htmx
 * navigation into `#main` with URL push.
 * @param opts.html Trusted rendered HTML for the requesting element's target. @default ""
 * @param opts.oob Out-of-band fragments keyed by element id; each value is trusted inner HTML swapped into that element.
 * @param opts.toast Corner notification shown after the swap.
 * @param opts.trigger Client event names fired on the requesting element after the response.
 * @param opts.redirect URL for a full-page redirect through `HX-Redirect`.
 * @param opts.location URL for an htmx navigation through `HX-Location` (swaps `#main`, pushes history).
 * @param opts.status HTTP status code. @default 200 @minimum 100 @maximum 599
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted rendered HTML for the requesting element's target. @default "" */
    html?: string;
    /** Out-of-band fragments keyed by element id; each value is trusted inner HTML swapped into that element. */
    oob?: Record<string, string>;
    /** Corner notification shown after the swap. */
    toast?: { message: string; level?: "info" | "warn" | "error" };
    /** Client event names fired on the requesting element after the response. */
    trigger?: string[];
    /** URL for a full-page redirect through `HX-Redirect`. */
    redirect?: string;
    /** URL for an htmx navigation through `HX-Location` (swaps `#main`, pushes history). */
    location?: string;
    /** HTTP status code. @default 200 @minimum 100 @maximum 599 */
    status?: number;
}): Response {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const oob = Object.entries(opts.oob ?? {})
        .map(([id, inner]) => `<div id="${esc(id)}" hx-swap-oob="innerHTML">${inner}</div>`).join("");
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    const events: Record<string, unknown> = {};
    for (const name of opts.trigger ?? []) events[name] = true;
    if (opts.toast) events["hyper-toast"] = { message: opts.toast.message, level: opts.toast.level ?? "info" };
    if (Object.keys(events).length) headers["HX-Trigger"] = JSON.stringify(events);
    if (opts.redirect) headers["HX-Redirect"] = opts.redirect;
    if (opts.location) headers["HX-Location"] = JSON.stringify({ path: opts.location, target: "#main", swap: "innerHTML" });
    return new Response(`${opts.html ?? ""}${oob}`, { status: opts.status ?? 200, headers });
}
