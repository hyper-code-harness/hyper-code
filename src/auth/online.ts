/**
 * Renders who is online as round avatars with a green ring: everyone in this Hyper, or only this chat.
 *
 * "Online" = at least one open Hyper tab (an open event stream, procs.events.presence); "in this chat" =
 * a tab currently showing that chat. The viewer is left out (their own avatar is elsewhere). Each avatar
 * shows the sign-in photo or colored initials, name on hover. Returns "" on a single-user local Hyper
 * (same rule as chat authors) or when nobody else is there. GET /auth/online serves it as a live region.
 * @param opts.agentId Only people looking at this chat; omit for everyone in this Hyper.
 * @param opts.layout "row" (inspector header) or "column" (left quick bar). @default "row"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only people looking at this chat; omit for everyone in this Hyper. */
    agentId?: string;
    /** "row" (inspector header) or "column" (left quick bar). @default "row" */
    layout?: "row" | "column";
}): Promise<string> {
    const me = await ctx.fns.auth.viewerId({}).catch(() => null);
    const here = ctx.fns.procs.events.presence({ agentId: opts.agentId }).filter((p) => p.id !== "local" && p.id !== me);
    if (!here.length) return "";
    const esc = (v: string) => ctx.fns.procs.ui.escape({ text: v });
    const column = opts.layout === "column";
    const size = column ? "size-7 text-[0.6rem]" : "size-6 text-[0.55rem]";
    const ring = "ring-2 ring-success ring-offset-1 ring-offset-base-100";
    const faces: string[] = [];
    for (const p of here) {
        const a = await ctx.fns.auth.author({ userId: p.id });
        if (!a) continue;
        const face = a.picture
            ? `<img src="${esc(a.picture)}" alt="" class="${size} rounded-full object-cover ${ring}" referrerpolicy="no-referrer">`
            : `<span class="inline-flex ${size} items-center justify-center rounded-full font-semibold text-white ${ring}" style="background:hsl(${a.hue} 55% 45%)">${esc(a.initials)}</span>`;
        const where = opts.agentId ? "in this chat" : "online";
        faces.push(`<span class="inline-flex" title="${esc(a.name)} — ${where}${!opts.agentId && p.tabs > 1 ? ` (${p.tabs} tabs)` : ""}" data-online="${esc(a.id)}">${face}</span>`);
    }
    if (!faces.length) return "";
    const label = opts.agentId ? "In this chat" : "Online now";
    return `<div class="flex ${column ? "flex-col" : ""} items-center gap-1.5" aria-label="${label}: ${faces.length}">${faces.join("")}</div>`;
}
