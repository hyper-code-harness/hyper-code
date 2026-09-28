/**
 * Renders who is online right now as a row of round avatars with a green ring, for the agent inspector.
 *
 * "Online" means the person has at least one open Hyper tab (an open event stream, procs.events.presence).
 * Each avatar shows the profile photo from sign-in, or colored initials, and the name on hover. Returns
 * "" on a single-user local Hyper (same rule as chat authors) or when nobody identified is online.
 * Use inside a live region on topic "presence"; GET /auth/online serves the same fragment.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const here = ctx.fns.procs.events.presence({}).filter((p) => p.id !== "local");
    if (!here.length) return "";
    const esc = (v: string) => ctx.fns.procs.ui.escape({ text: v });
    const faces: string[] = [];
    for (const p of here) {
        const a = await ctx.fns.auth.author({ userId: p.id });
        if (!a) continue;
        const ring = "ring-2 ring-success ring-offset-1 ring-offset-base-100";
        const face = a.picture
            ? `<img src="${esc(a.picture)}" alt="" class="size-6 rounded-full object-cover ${ring}" referrerpolicy="no-referrer">`
            : `<span class="inline-flex size-6 items-center justify-center rounded-full text-[0.55rem] font-semibold text-white ${ring}" style="background:hsl(${a.hue} 55% 45%)">${esc(a.initials)}</span>`;
        faces.push(`<span class="inline-flex" title="${esc(a.name)} — online${p.tabs > 1 ? ` (${p.tabs} tabs)` : ""}" data-online="${esc(a.id)}">${face}</span>`);
    }
    if (!faces.length) return "";
    return `<div class="flex items-center gap-1.5" aria-label="Online now: ${esc(String(faces.length))}">${faces.join("")}</div>`;
}
