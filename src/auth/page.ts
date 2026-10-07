/**
 * Renders a small standalone auth page (sign-in or setup) as a full HTML response.
 *
 * Standalone because it is shown before sign-in, outside the app layout.
 * @param opts.title Browser tab title.
 * @param opts.body Trusted inner HTML, usually one form.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Browser tab title. */
        title: string;
        /** Trusted inner HTML, usually one form. */
        body: string;
    },
): Response {
    const css = "html{color-scheme:light dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;font:16px -apple-system,system-ui;background:#16181d;color:#f5f5f5;background-image:radial-gradient(circle,#ffffff20 1px,transparent 1.3px);background-size:16px 16px}form{width:min(24rem,calc(100vw - 2rem));box-sizing:border-box;padding:1.5rem;border:1px solid #ffffff22;border-radius:1.25rem;background:#24272dcc;backdrop-filter:blur(18px);box-shadow:0 18px 60px #0006}h1{margin:0 0 .4rem;font-size:1.3rem}p{margin:.2rem 0 1rem;color:#ffffff99}.err{color:#fca5a5}label{display:block;margin-top:.7rem;font-size:.85rem;color:#ffffffaa}input,button{box-sizing:border-box;width:100%;min-height:46px;border-radius:.8rem;font:inherit}input{border:1px solid #ffffff2a;background:#101217;padding:0 .9rem;color:white;margin-top:.3rem}button{margin-top:1rem;border:0;background:#6366f1;color:white;font-weight:650}";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${opts.title} · Hyper</title><link rel="icon" href="/favicon.ico"><style>${css}</style></head><body>${opts.body}</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
