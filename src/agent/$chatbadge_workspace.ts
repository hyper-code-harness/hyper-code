// Chat header badge: a folder icon for the chat's working folder; the full path is in the tooltip and the
// title of the file viewer it opens (host:path for a remote one).
export default {
    order: 10,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.Item | null {
        const dir = String(view.agent.workspaceDir ?? "").trim();
        if (!dir) return null;
        const host = String(view.agent.workspaceHost ?? "").trim();
        return {
            icon: host ? "ph-hard-drives" : "ph-folder-open",
            title: host ? `Remote files · ${host}:${dir}` : `Files · ${dir}`,
            popup: { method: "ui.previewFile", params: { path: dir, ...(host ? { host } : {}), mode: "auto", title: host ? `${host}:${dir}` : dir } },
        };
    },
} satisfies types.chat.Badge;
