/**
 * Render the offline Lucide catalogue as a searchable standalone page
 *
 * Build the plugin canvas browser with local SVG previews, lexical name and tag search, details and SVG downloads. All data is bundled into the sandboxed page; no network or mutation.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const { fileURLToPath } = await import("node:url");
    const base = new URL("../../assets/", import.meta.url);
    const rows: Array<{name:string;tags:string[]}> = await Bun.file(fileURLToPath(new URL("catalog.json",base))).json();
    const data = await Promise.all(rows.map(async row => ({...row,svg:(await ctx.fns.icons.get({name:row.name})).svg})));
    const template = await Bun.file(fileURLToPath(new URL("browser.html",base))).text();
    return template.replace("__ICON_DATA__", JSON.stringify(data).replace(/</g,"\\u003c"));
}
