/**
 * Shows one tab of the Chrome that browser.* functions drive, live, as a page: a picture of the tab that takes
 * clicks, typing and scrolling, with tabs, back, forward, reload and an address bar.
 *
 * Use for an address of the shared browser: `/rpc/browser.page?{"target":"<targetId>"}` — a chat link or a browser
 * tab. On the canvas use the `browser.live` kind: it shows the same page without a second address bar. Sites that refuse to be framed (Google, GitHub,
 * logins) show here, because this is a picture of a real Chrome, not the site in a frame. Without `target` the
 * most recently used page is shown. The page runs in a frame of the live view (`/browser/live`).
 * @param opts.target Chrome target id of the tab to show; the most recent page when omitted.
 * @view
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chrome target id of the tab to show; the most recent page when omitted. */
    target?: string;
}): Promise<string> {
    const q = new URLSearchParams();
    if (opts.target) q.set("target", String(opts.target));
    const src = `/browser/live${q.size ? `?${q}` : ""}`;
    return ctx.fns.rpc.frame({ src, title: "Live browser" });
}
