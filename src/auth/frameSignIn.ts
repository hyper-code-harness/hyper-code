// An anonymous request for a page that loads INSIDE a frame (a canvas tab: /code/tests, /gcal, an rpc.frame
// app, an html tab's sandboxed document) must not be redirected to /auth/login in that frame: the OIDC and
// Google buttons there navigate the frame to a provider that forbids framing (frame-ancestors 'none',
// X-Frame-Options: DENY), so the tab goes blank, and a successful sign-in would only fix the one frame.
// Instead the frame gets a small page that sends the whole window to sign-in and back to the page around it.

/**
 * Answers an anonymous frame navigation with a 401 sign-in page that breaks out to the top window.
 *
 * Use from the sign-in gate when `Sec-Fetch-Dest` is `iframe` or `frame`. The "Sign in" link targets the top
 * window and returns to the framing page (the same-origin Referer, else `/`); a second link opens sign-in in a
 * new tab for sandboxed frames that may not navigate the top window. Script-free, framable only by Hyper itself.
 * @param opts.req The anonymous frame request.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The anonymous frame request. */
    req: Request;
}): Response {
    const url = new URL(opts.req.url);
    let next = "/";
    const referer = opts.req.headers.get("referer");
    if (referer) {
        try {
            const r = new URL(referer);
            // Same origin only: never send the person back to (or leak the path of) another site.
            if (r.origin === url.origin && !r.pathname.startsWith("/auth/")) next = r.pathname + r.search;
        } catch { next = "/"; }
    }
    const href = `/auth/login?next=${encodeURIComponent(next)}`;
    const esc = (text: string) => ctx.fns.w.escape({ text });
    const page = ctx.fns.auth.page({
        title: "Sign in",
        body: `<form><h1>Hyper</h1><p>Your session has ended. Sign in to see this tab.</p>`
            + `<a href="${esc(href)}" target="_top" style="display:block;text-align:center;padding:.8rem;border-radius:.8rem;background:#6366f1;color:#fff;font-weight:650;text-decoration:none">Sign in</a>`
            + `<p style="margin-top:.8rem;text-align:center"><a href="${esc(href)}" target="_blank" rel="noopener" style="color:#a5b4fc">Open sign-in in a new tab</a></p></form>`,
    });
    return new Response(page.body, {
        status: 401,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
            "x-content-type-options": "nosniff",
        },
    });
}
