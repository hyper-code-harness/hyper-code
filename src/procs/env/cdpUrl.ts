// The one place that knows where "the browser" is. Every browser, screen and
// sidebar function asks here instead of carrying its own default, so a test env
// (CDP_BROWSER_URL = the suite's headless Chrome, see test/chrome/headless.ts)
// can never fall through to the developer's Chrome.

/**
 * Returns the Chrome DevTools (CDP) HTTP endpoint this environment drives, without a trailing slash.
 * CDP_BROWSER_URL when set, otherwise http://127.0.0.1:9222. Use it whenever code needs to talk to the browser instead of hard-coding an address.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): string {
    return String(ctx.env.CDP_BROWSER_URL || "http://127.0.0.1:9222").replace(/\/+$/, "");
}
