/**
 * Draws a block of code with syntax highlighting (shiki, all theme colours inlined as variables, so the page
 * theme switches them without re-highlighting), an optional file name, line numbers, and a copy button.
 * @param opts.code The source text.
 * @param opts.lang Language id (ts, js, json, sql, bash, md, …). @default "text"
 * @param opts.title File name or caption above the code.
 * @param opts.lineNumbers Show line numbers. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The source text. */
    code: string;
    /** Language id (ts, js, json, sql, bash, md, …). @default "text" */
    lang?: string;
    /** File name or caption above the code. */
    title?: string;
    /** Show line numbers. @default false */
    lineNumbers?: boolean;
}): Promise<string> {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const html = await ctx.fns.markdown.highlight({ code: String(opts.code ?? "").replace(/\n$/, ""), lang: opts.lang ?? "text" });
    const copy = `<button type="button" class="w-code-copy" title="Copy" aria-label="Copy code" onclick="navigator.clipboard?.writeText(this.closest('.w-code').querySelector('pre').innerText)">${ctx.fns.w.icon({ name: "copy", size: 14 })}</button>`;
    const head = opts.title || opts.lang ? `<div class="w-code-head"><span>${esc(opts.title ?? opts.lang)}</span>${copy}</div>` : copy;
    return `<figure class="w-code"${opts.lineNumbers ? " data-lines" : ""}>${head}${html}</figure>`;
}
