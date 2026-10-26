// What a `@view` function's result becomes at GET /rpc/<fn>?<json>: an html fragment. htmx asks for it
// (HX-Request) and gets the fragment alone — a canvas view tab swaps it into its body; a plain browser visit
// gets the same fragment inside the Hyper page layout. A view returns trusted html: it is code from the repo,
// a plugin or a ~/.hyper level, which already runs with ctx. Html that agents or people wrote as content
// (a memory note, a saved page) is cleaned by the view that shows it (rpc.cleanHtml). A page that needs its
// own scripts in isolation returns an <iframe> in its fragment.

/**
 * Turns the result of a `@view` function into the html fragment served at its address.
 *
 * Use from GET /rpc/<fn> (and tests): a string result is html as it is; an array of objects becomes a w.table; any
 * other value is pretty JSON; an error becomes a w.empty in the danger tone. The fragment is wrapped in
 * `<div class="rpc-view">` so the rpc stylesheet applies the same way in a canvas tab and in a full page.
 * @param opts.title Page title, usually the function name.
 * @param opts.value What the view function returned.
 * @param opts.error Error text instead of a value.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Page title, usually the function name. */
    title: string;
    /** What the view function returned. */
    value?: unknown;
    /** Error text instead of a value. */
    error?: string;
}): string {
    const w = ctx.fns.w;
    const esc = (text: string) => w.escape({ text });
    let body: string;
    if (opts.error !== undefined) body = w.empty({ title: opts.error, hint: opts.title, icon: "warning-circle", tone: "danger" });
    else if (typeof opts.value === "string") body = opts.value;
    else if (Array.isArray(opts.value) && opts.value.length && opts.value.every(r => r && typeof r === "object" && !Array.isArray(r))) body = w.table({ rows: opts.value as Array<Record<string, unknown>> });
    else body = w.box({ body: esc(JSON.stringify(opts.value ?? null, null, 2)), mix: { mono: true, pre: true, text: "ui" } });
    return `<div class="rpc-view" data-rpc-view="${esc(opts.title)}">${body}</div>`;
}
