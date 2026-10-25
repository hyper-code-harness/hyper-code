// The built-in file tab: the Files viewer (preview, code, edit, directory listing) drawn straight into the
// canvas by files.view — the same renderer as the /files page, no iframe, so it needs no second page load
// and no second sign-in (behind a sign-in gateway a framed page could fall to a login it cannot show).
// Links inside it (breadcrumbs, folder entries, Preview/Code/Edit) are caught by canvas.js and move this
// same tab (canvas.navigate), so the tab is a small file browser.

export const hint = "a file or directory from the workspace (or an SSH host) in the full Files viewer — args `{ path, host?, mode?: \"auto\"|\"preview\"|\"source\" }`";

export default {
    icon: "file-text",
    live: true,
    async prepare(ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const path = String(opts.args.path ?? "").trim();
        if (!path) throw new Error("canvas file: args.path is required");
        const mode = ["preview", "source"].includes(opts.args.mode) ? opts.args.mode : "auto";
        const tab = ["preview", "code", "edit"].includes(opts.args.tab) ? opts.args.tab : mode === "preview" ? "preview" : mode === "source" ? "code" : "";
        // Resolve against the TARGET agent's workspace (not the caller's), and pin the result: an absolute
        // path plus an explicit host ("local" or an alias), so rendering never reinterprets it.
        const ws = ((await ctx.fns.procs.db.select({ sql: "SELECT workspace_dir, workspace_host FROM agents WHERE id = ?", params: [opts.agentId] })) as any[])[0] ?? {};
        const asked = String(opts.args.host ?? "").trim();
        const wsHost = String(ws.workspace_host ?? "").trim();
        const host = asked || wsHost || "local";
        const base = host === "local" ? (wsHost ? "" : String(ws.workspace_dir ?? "")) : host === wsHost ? String(ws.workspace_dir ?? "") : "";
        const absolute = path.startsWith("/") || path === "~" || path.startsWith("~/") || !base ? path : base.replace(/\/+$/, "") + "/" + path.replace(/^\.\//, "");
        const at = await ctx.fns.files.embedUrl({ path: absolute, host, mode });
        const name = at.path.split("/").filter(Boolean).pop() || at.path;
        return { args: { path: at.path, host: at.host ?? "local", mode, ...(tab ? { tab } : {}) }, title: at.host ? `${at.host}:${name}` : name };
    },
    async render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.w.escape({ text });
        const a = opts.item.args;
        try {
            const host = a.host && a.host !== "local" ? String(a.host) : undefined;
            const info = await ctx.fns.files.stat({ path: String(a.path), host });
            if (!info) throw new Error(`file not found: ${host ? host + ":" : ""}${a.path}`);
            const tab = ["preview", "code", "edit"].includes(a.tab) ? a.tab : a.mode === "preview" ? "preview" : a.mode === "source" ? "code" : "";
            const view = await ctx.fns.files.view({ path: String(a.path), host, isDir: info.isDir, tab, wide: true, assetsBase: true });
            return `<div data-canvas-files class="flex h-full min-h-0 flex-col">${view.html}</div>`;
        } catch (error: any) {
            return `<div class="flex h-full items-center justify-center p-6 text-sm text-faint">${esc(String(error?.message ?? error))}</div>`;
        }
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        const view = a.tab ? a.tab : a.mode && a.mode !== "auto" ? a.mode : "";
        return `file ${a.host && a.host !== "local" ? a.host + ":" : ""}${a.path}${view ? ` (${view})` : ""}`;
    },
} satisfies types.canvas.Kind;
