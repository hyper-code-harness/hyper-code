/**
 * Returns the browser tab icon of this Hyper instance as a data URL
 *
 * Resolves the favicon every page shell inlines: the instance override stored by ui.setFavicon (setting ui.favicon, or HYPER_FAVICON) when present, otherwise the built-in Hyper terminal-prompt icon. Use it when rendering a standalone HTML document that should carry the instance icon.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const custom = String(await ctx.fns.settings.getString({ module: "ui", scopeType: "global", key: "favicon", fallback: "" }) ?? "").trim();
        if (/^data:image\//.test(custom)) return custom;
        // A tiny terminal prompt: dark enough to survive light browser chrome, with a mint chevron and violet cursor
        // that remain legible at 16×16.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#252a34"/><path d="m8 9 7 7-7 7" fill="none" stroke="#6ee7b7" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 23H25" stroke="#a78bfa" stroke-width="3.2" stroke-linecap="round"/><circle cx="25" cy="7" r="2.3" fill="#fb7185"/></svg>';
        return "data:image/svg+xml," + encodeURIComponent(svg);
}
