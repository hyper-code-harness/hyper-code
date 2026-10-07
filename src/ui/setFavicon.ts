/**
 * Sets or resets the browser tab icon of this Hyper instance
 *
 * Overrides the favicon shown in browser tabs for this Hyper instance only. The icon is stored in this instance's settings database (setting ui.favicon), never in source control, so every deployment can carry its own icon. Pass exactly one source: an image file path (svg, png, ico, gif, webp, jpg), raw SVG markup, an emoji (optionally on a coloured rounded square), or a ready data:image URL. reset: true returns to the built-in Hyper icon. Open pages show the new icon after a reload.
 * @param opts.path Image file to use, resolved against the workspace: .svg, .png, .ico, .gif, .webp or .jpg, at most 256 KB once encoded.
 * @param opts.svg Raw SVG markup for the icon; a square viewBox such as 0 0 32 32 looks best at 16×16.
 * @param opts.emoji Emoji or short text drawn as the icon, e.g. 🧪 for a staging instance.
 * @param opts.background CSS colour of a rounded square behind the emoji, e.g. #dc2626; omitted draws the emoji alone. Only used with emoji.
 * @param opts.dataUrl Ready data:image/... URL to store as is.
 * @param opts.reset Remove the override and return to the built-in Hyper icon. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Image file to use, resolved against the workspace: .svg, .png, .ico, .gif, .webp or .jpg, at most 256 KB once encoded. */
        path?: string;
        /** Raw SVG markup for the icon; a square viewBox such as 0 0 32 32 looks best at 16×16. */
        svg?: string;
        /** Emoji or short text drawn as the icon, e.g. 🧪 for a staging instance. */
        emoji?: string;
        /** CSS colour of a rounded square behind the emoji, e.g. #dc2626; omitted draws the emoji alone. Only used with emoji. */
        background?: string;
        /** Ready data:image/... URL to store as is. */
        dataUrl?: string;
        /** Remove the override and return to the built-in Hyper icon. @default false */
        reset?: boolean;
    },
): Promise<{ favicon: 'custom' | 'default'; bytes: number }> {
    if (opts.reset) {
            await ctx.fns.procs.db.run({ sql: "DELETE FROM settings WHERE module = 'ui' AND scope_type = 'global' AND scope_id = '' AND key = 'favicon'", params: [] });
            return { favicon: "default", bytes: 0 };
        }
        const given = [opts.path, opts.svg, opts.emoji, opts.dataUrl].filter(v => v != null && v !== "").length;
        if (given !== 1) throw new Error("ui.setFavicon: pass exactly one of path, svg, emoji, dataUrl — or reset: true");
        let url: string;
        if (opts.dataUrl) {
            if (!/^data:image\/(svg\+xml|png|x-icon|vnd\.microsoft\.icon|gif|webp|jpeg)[;,]/.test(opts.dataUrl)) throw new Error("ui.setFavicon: dataUrl must be a data:image/... URL");
            url = opts.dataUrl;
        } else if (opts.svg) {
            if (!/<svg[\s>]/.test(opts.svg)) throw new Error("ui.setFavicon: svg must contain an <svg> element");
            url = "data:image/svg+xml," + encodeURIComponent(opts.svg.trim());
        } else if (opts.emoji) {
            const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
            const bg = opts.background ? '<rect width="32" height="32" rx="8" fill="' + esc(opts.background).replace(/"/g, "") + '"/>' : "";
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' + bg + '<text x="16" y="17" font-size="' + (bg ? 22 : 28) + '" text-anchor="middle" dominant-baseline="central">' + esc(opts.emoji) + '</text></svg>';
            url = "data:image/svg+xml," + encodeURIComponent(svg);
        } else {
            const abs = await ctx.fns.workspace.resolve({ path: opts.path! });
            const file = Bun.file(abs);
            if (!(await file.exists())) throw new Error("ui.setFavicon: no such file: " + abs);
            const ext = abs.toLowerCase().split(".").pop() ?? "";
            const mime: Record<string, string> = { svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", gif: "image/gif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };
            if (!mime[ext]) throw new Error("ui.setFavicon: unsupported image type ." + ext + " (svg, png, ico, gif, webp, jpg)");
            url = ext === "svg"
                ? "data:image/svg+xml," + encodeURIComponent((await file.text()).trim())
                : "data:" + mime[ext] + ";base64," + Buffer.from(await file.arrayBuffer()).toString("base64");
        }
        if (url.length > 256 * 1024) throw new Error("ui.setFavicon: icon is " + Math.round(url.length / 1024) + " KB; keep it under 256 KB (it is inlined into every page)");
        await ctx.fns.settings.set({ module: "ui", scopeType: "global", key: "favicon", value: url });
        return { favicon: "custom", bytes: url.length };
}
