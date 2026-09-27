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
    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.path });
    const host = at.host ?? undefined;
    let path = host ? at.path : ctx.fns.files.resolveSafe({ path: opts.path });
    if (host && !path.startsWith("/")) {
        const q = ctx.fns.remote.quote({ value: path, path: true });
        const r = await ctx.fns.remote.exec({ host, command: 'f=' + q + '; [ -e "$f" ] || exit 2; if [ -d "$f" ]; then cd -- "$f" && pwd -P; else printf "%s/%s" "$(cd -- "$(dirname -- "$f")" && pwd -P)" "$(basename -- "$f")"; fi', timeout: 30 });
        if (r.exitCode !== 0) throw new Error(`file not found: ${host}:${opts.path}`);
        path = r.stdout.trim();
    }
    const info = await ctx.fns.files.stat({ path, host });
    if (!info) throw new Error(`file not found: ${host ? host + ":" : ""}${opts.path}`);

    const mode = opts.mode ?? "auto";
    const baseUrl = (await ctx.fns.files.browserUrl({ path, host })).replace("/files/absolute/", "/files/embed/").replace("/files/remote/", "/files/remote/embed/");
    const params = new URLSearchParams();
    if (mode === "preview") params.set("tab", "preview");
    if (mode === "source") params.set("tab", "code");
    const url = params.size ? `${baseUrl}?${params}` : baseUrl;
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
