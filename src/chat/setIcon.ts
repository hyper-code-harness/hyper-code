/**
 * Sets, replaces or resets the icon of a chat — the picture at the left of the chat header.
 *
 * The icon is shown instead of the model logo in the chat header, Dock pins and chat lists; the model
 * itself is shown in the chat input. Pass exactly one source: raw SVG markup (cleaned by
 * chat.sanitizeSvg, at most 8 KB), or an emoji drawn on a coloured circle; reset: true returns to the model
 * logo. An agent may call this for itself to pick its own face. Returns the stored SVG (null after reset).
 * @param opts.id Agent whose icon changes. @default the calling agent
 * @param opts.svg Raw SVG markup; a square viewBox such as 0 0 32 32 looks best.
 * @param opts.emoji One emoji or up to two letters drawn in the middle of a circle, e.g. 🦊 or HC.
 * @param opts.background CSS colour of the circle behind the emoji, e.g. #7c3aed. @default "#334155"
 * @param opts.reset Remove the icon and show the model logo again. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose icon changes. @default the calling agent */
        id?: string;
        /** Raw SVG markup; a square viewBox such as 0 0 32 32 looks best. */
        svg?: string;
        /** One emoji or up to two letters drawn in the middle of a circle, e.g. 🦊 or HC. */
        emoji?: string;
        /** CSS colour of the circle behind the emoji, e.g. #7c3aed. @default "#334155" */
        background?: string;
        /** Remove the icon and show the model logo again. @default false */
        reset?: boolean;
    },
): Promise<{ id: string; icon: string | null }> {
    const id = String(opts.id ?? "").trim() || (await ctx.fns.agent.current({})).id;
    const sources = [opts.svg, opts.emoji, opts.reset ? true : undefined].filter(v => v !== undefined && v !== "");
    if (sources.length !== 1) throw new Error("chat.setIcon: pass exactly one of svg, emoji or reset");
    let icon: string | null = null;
    if (opts.svg) icon = ctx.fns.chat.sanitizeSvg({ svg: opts.svg });
    else if (opts.emoji) {
        const text = [...String(opts.emoji).trim()].slice(0, 2).join("");
        const bg = String(opts.background ?? "#334155").trim();
        if (!/^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%]+\))$/i.test(bg)) throw new Error("chat.setIcon: background must be a CSS colour such as #7c3aed");
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const letters = /^[\p{L}\p{N}]+$/u.test(text);
        icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${esc(bg)}"/><text x="16" y="16" dy=".35em" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-weight="600" font-size="${letters ? (text.length > 1 ? 13 : 16) : 18}" fill="#fff">${esc(text)}</text></svg>`;
    }
    const res: any = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET icon = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL", params: [icon, Date.now(), id] });
    if (Number(res?.changes ?? res?.rowCount ?? res?.count ?? 1) === 0) throw new Error(`agent not found: ${id}`);
    const live = (ctx.state as any).agent?.[id];
    if (live) live.icon = icon;
    await ctx.fns.events.emitAgentsChanged({ agentId: id, reason: "icon" });
    return { id, icon };
}
