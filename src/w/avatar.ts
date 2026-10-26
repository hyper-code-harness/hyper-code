/**
 * Draws a person or an agent: photo, coloured initials, or the agent's own chat icon.
 * @param opts.name Name for initials and the tooltip.
 * @param opts.src Photo URL.
 * @param opts.agentId Draw this agent's chat icon (avatar or model logo) instead of initials.
 * @param opts.size Size in px. @default 24
 * @param opts.online The person is here now: a green ring around the face.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Name for initials and the tooltip. */
    name?: string;
    /** Photo URL. */
    src?: string;
    /** Draw this agent's chat icon (avatar or model logo) instead of initials. */
    agentId?: string;
    /** Size in px. @default 24 */
    size?: 20 | 24 | 32 | 40;
    /** The person is here now: a green ring around the face. */
    online?: boolean;
}): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const size = opts.size ?? 24;
    const on = opts.online ? " data-online" : "";
    const name = String(opts.name ?? "");
    if (opts.agentId) {
        const row: any = ((await ctx.fns.procs.db.select({ sql: "SELECT icon, model, title FROM agents WHERE id = ?", params: [opts.agentId] }).catch(() => [])) as any[])[0];
        const face = row ? ctx.fns.w.chatIcon({ icon: row.icon ?? "", model: String(row.model ?? ""), size: size >= 32 ? "md" : "sm" }) : ctx.fns.w.icon({ name: "robot" });
        return `<span class="w-avatar" data-size="${size}"${on} data-kind="agent" title="${esc(name || row?.title || opts.agentId)}">${face}</span>`;
    }
    const src = opts.src ? ctx.fns.w.safeUrl({ url: opts.src, image: true }) : null;
    if (src) return `<span class="w-avatar" data-size="${size}"${on} title="${esc(name)}"><img src="${esc(src)}" alt="" referrerpolicy="no-referrer" loading="lazy"></span>`;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="w-avatar" data-size="${size}"${on} style="--w-hue:${h}" title="${esc(name)}" aria-label="${esc(name)}">${esc(initials)}</span>`;
}
