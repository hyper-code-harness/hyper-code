// The built-in file tab: the full Files UI (preview, code, edit, directory listing) framed on the canvas —
// the same embed the file popup uses (files.embedUrl), so both stay one viewer.

export const hint = "a file or directory from the workspace (or an SSH host) in the full Files viewer — args `{ path, host?, mode?: \"auto\"|\"preview\"|\"source\" }`";

export default {
    icon: "file-text",
    async prepare(ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const path = String(opts.args.path ?? "").trim();
        if (!path) throw new Error("canvas file: args.path is required");
        const mode = ["preview", "source"].includes(opts.args.mode) ? opts.args.mode : "auto";
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
        return { args: { path: at.path, host: at.host ?? "local", mode }, title: at.host ? `${at.host}:${name}` : name };
    },
    async render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
        const at = await ctx.fns.files.embedUrl({ path: opts.item.args.path, host: opts.item.args.host, mode: opts.item.args.mode }).catch((e: any) => ({ error: String(e?.message ?? e) }));
        if ("error" in at) return `<div class="flex h-full items-center justify-center p-6 text-sm text-faint">${esc(at.error)}</div>`;
        return `<iframe src="${esc(at.url)}" title="${esc(opts.item.title)}" class="block h-full w-full border-0 bg-base-200" loading="eager"></iframe>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        return `file ${a.host && a.host !== "local" ? a.host + ":" : ""}${a.path}${a.mode && a.mode !== "auto" ? ` (${a.mode})` : ""}`;
    },
} satisfies types.canvas.Kind;
