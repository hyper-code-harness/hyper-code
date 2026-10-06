// A link a human can open to see and drive one Chrome tab: for a CAPTCHA, a
// 2FA prompt or a login the agent must not do itself. Nothing is started here —
// the page and its WebSocket are ordinary Hyper routes — so this only resolves
// the tab and builds the address.

/**
 * Returns a live-view link that shows one Chrome tab to a human and lets them click, type and scroll in it.
 *
 * Use when a page needs a person: CAPTCHA, two-factor prompt, sign-in, consent, payment confirmation.
 * `tab` is a named browser session (as used by browser.* functions, e.g. `main`) or a raw target id;
 * without it the most recently active page is shown. The link is served by this Hyper (same sign-in),
 * over HTTPS on the tailnet name when available. Give the URL to the human and wait for them to say they
 * are done; do not drive the same tab with browser.* calls meanwhile.
 * @param opts.tab Named browser session or Chrome target id to show.
 * @param opts.cdp Chrome DevTools endpoint when it is not the default one; must be allowed by setting browser.liveCdpAllow.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Named browser session or Chrome target id to show. */
        tab?: string;
        /** Chrome DevTools endpoint when it is not the default one; must be allowed by setting browser.liveCdpAllow. */
        cdp?: string;
    } = {},
): Promise<{ url: string; targetId: string; title: string; pageUrl: string }> {
    const { browserUrl, isDefault } = await ctx.fns.browser.liveCdp({ requested: opts.cdp });
    const res = await fetch(`${browserUrl}/json`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (!res?.ok) throw new Error(`Chrome DevTools is not reachable at ${browserUrl}`);
    const pages = ((await res.json()) as any[]).filter((t) => t.type === "page" && !String(t.url).startsWith("devtools://"));
    let targetId = "";
    if (opts.tab) {
        const named = isDefault ? ((ctx.state as any).cdp?.sessions as Map<string, any> | undefined)?.get(opts.tab) : undefined;
        targetId = named?.targetId ?? opts.tab;
        if (!pages.some((p) => p.id === targetId)) throw new Error(`No open tab "${opts.tab}" in Chrome at ${browserUrl}`);
    } else {
        targetId = pages[0]?.id ?? "";
        if (!targetId) throw new Error(`Chrome at ${browserUrl} has no open page`);
    }
    const page = pages.find((p) => p.id === targetId);
    const q = new URLSearchParams({ target: targetId });
    if (!isDefault) q.set("cdp", browserUrl);
    return { url: `${await ctx.fns.browser.liveBase({})}/browser/live?${q}`, targetId, title: String(page?.title ?? ""), pageUrl: String(page?.url ?? "") };
}
