// The document a `@view` function's result becomes at GET /rpc/<fn>?<json>. Isolation like an html canvas tab
// (canvas.htmlFrame): a CSP header with a `sandbox` directive gives the page an opaque origin even when opened
// directly, so html built from memory (a note's markdown) cannot reach the app or its cookies. A tiny bridge
// makes /rpc links inside a canvas frame move the tab (the parent navigates it — a sandboxed frame's own
// requests carry no cookies); opened as a normal browser tab the links just work.

const CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "img-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
].join("; ");

const STYLE = `html{color-scheme:light dark}body{margin:0;padding:16px 20px;font:14px/1.55 -apple-system,system-ui,sans-serif;color:#1f2328;background:#fff}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}th,td{border-color:#30363d!important}code,pre{background:#161b22!important}a{color:#58a6ff}}
a{color:#0969da}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d0d7de;padding:5px 8px;text-align:left;vertical-align:top}th{font-weight:600}
code,pre{background:#f6f8fa;border-radius:4px;font:12px ui-monospace,monospace}code{padding:1px 4px}pre{padding:10px;overflow:auto}.rpc-error{color:#cf222e}.rpc-muted{color:#8b949e;font-size:12px}`;

// In a frame: /rpc links ask the canvas to move this tab; other links open a new browser tab.
const BRIDGE = `(()=>{if(parent===window)return;addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;let u;try{u=new URL(a.getAttribute('href'),location.href)}catch{return}
if(u.origin===location.origin&&u.pathname.startsWith('/rpc/')){e.preventDefault();parent.postMessage({hyperCanvas:1,type:'navigate',url:u.pathname+u.search},'*')}else{a.target='_blank';a.rel='noopener noreferrer'}},true)})()`;

/**
 * Wraps the result of a `@view` function into a sandboxed html page response.
 *
 * Use from GET /rpc/<fn> (and tests): a string result is html; any other value is shown as a table (an array of
 * objects) or pretty JSON; an error becomes a readable error page with the given status.
 * @param opts.title Page title, usually the function name.
 * @param opts.value What the view function returned.
 * @param opts.error Error text instead of a value.
 * @param opts.status HTTP status. @default 200
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Page title, usually the function name. */
    title: string;
    /** What the view function returned. */
    value?: unknown;
    /** Error text instead of a value. */
    error?: string;
    /** HTTP status. @default 200 */
    status?: number;
}): Response {
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    let body: string;
    if (opts.error !== undefined) body = `<p class="rpc-error">${esc(opts.error)}</p><p class="rpc-muted">${esc(opts.title)}</p>`;
    else if (typeof opts.value === "string") body = opts.value;
    else if (Array.isArray(opts.value) && opts.value.length && opts.value.every(r => r && typeof r === "object" && !Array.isArray(r))) {
        const cols = [...new Set(opts.value.flatMap(r => Object.keys(r as object)))];
        const cell = (v: unknown) => v == null ? "" : typeof v === "object" ? `<code>${esc(JSON.stringify(v))}</code>` : esc(String(v));
        body = `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${opts.value.map(r => `<tr>${cols.map(c => `<td>${cell((r as any)[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    } else body = `<pre>${esc(JSON.stringify(opts.value ?? null, null, 2))}</pre>`;
    // A view that returns a whole document (a saved page with its own styles) is served as it is, with the
    // link bridge put in front; anything else is a fragment wrapped in the default page.
    const full = opts.error === undefined && /^\s*(<!doctype|<html)/i.test(body);
    const html = full
        ? body.replace(/^(\s*<!doctype[^>]*>)?/i, (m) => `${m}<script>${BRIDGE}</script>`)
        : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title><style>${STYLE}</style><script>${BRIDGE}</script></head><body>${body}</body></html>`;
    return new Response(html, {
        status: opts.status ?? 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
    });
}
