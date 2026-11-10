/**
 * Opens the full Files UI in a wide application popup without leaving the current agent.
 *
 * Use when the user asks to inspect or navigate files in a popup. The iframe uses the
 * canonical path-based Files URL, so relative Markdown links and media assets work, and
 * Files tabs such as Preview, Code, and Edit remain available.
 * @param opts.path Workspace-relative or absolute file or directory path to open.
 * @param opts.mode Initial file tab. Auto uses the Files UI default. @default auto
 * @param opts.title Optional popup title; defaults to the file path.
 * @param opts.maxChars Deprecated compatibility option; Files UI loads the complete file. @default 200000 @minimum 1 @maximum 1000000
 * @param opts.host SSH host alias the path lives on; omitted means the agent workspace (remote when it has a host).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Workspace-relative or absolute file or directory path to open. */
        path: string;
        /** Initial file tab. Auto uses the Files UI default. @default auto */
        mode?: "auto" | "preview" | "source";
        /** Optional popup title; defaults to the file path. */
        title?: string;
        /** Deprecated compatibility option; Files UI loads the complete file. @default 200000 @minimum 1 @maximum 1000000 */
        maxChars?: number;
        /** SSH host alias the path lives on; omitted means the agent workspace (remote when it has a host). */
        host?: string;
    },
): Promise<string | { path: string; mode: "auto" | "preview" | "source"; url: string }> {
    const mode = opts.mode ?? "auto";
    const { path, host, url } = await ctx.fns.files.embedUrl({ path: opts.path, host: opts.host, mode });
    const title = opts.title ?? (host ? `${host}:${path}` : path);
    const html = ctx.fns.ui.popupContent({
        title,
        kind: "file-preview",
        class: "h-full w-full",
        html: `<iframe src="${escapeAttribute(url)}" title="${escapeAttribute(title)}" class="block h-full w-full border-0 bg-base-200" loading="eager"></iframe>`,
    });

    // Popup RPC owns the swap into #app-popup-body. Returning the fragment is
    // essential: returning our metadata object makes procs.http.toResponse emit
    // JSON, which htmx then paints over the iframe created by ui.eval.
    if (session?.url?.pathname === "/rpc") return html;

    await ctx.fns.ui.eval({ code: `window.hyperPopup?.content(${JSON.stringify(html)}, ${JSON.stringify(title)}, 'file-preview')` });
    return { path, mode, url };
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
