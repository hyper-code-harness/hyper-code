/**
 * Shows the local Lucide SVG catalogue with English name and tag search, previews and downloads as a page.
 *
 * Use for an address of the icon browser: `/rpc/icons.page` — a canvas view tab (what the `icons.browser` kind
 * opens), a chat link or a browser tab. The browser runs in a sandboxed frame with its data inlined
 * (icons.browserHtml): scripts only, no network, no access to the Hyper page.
 * @view
 */
export default async function (ctx: Context, _session: Session | null, _opts: Record<string, never>): Promise<string> {
    const html = await ctx.fns.icons.browserHtml({});
    return ctx.fns.rpc.frame({ srcdoc: html, title: "Lucide icon search", sandbox: "allow-scripts allow-downloads" });
}
