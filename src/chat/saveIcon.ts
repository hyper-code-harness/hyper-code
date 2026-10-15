/**
 * Saves the icon chosen in the icon popup and reloads the page; a bad SVG reopens the editor with the error.
 * @param opts.agentId Agent whose icon changes.
 * @param opts.emoji Emoji or letters from the form.
 * @param opts.background Circle colour from the form.
 * @param opts.svg SVG markup from the form.
 * @param opts.reset Back to the model logo.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose icon changes. */
    agentId: string;
    /** Emoji or letters from the form. */
    emoji?: string;
    /** Circle colour from the form. */
    background?: string;
    /** SVG markup from the form. */
    svg?: string;
    /** Back to the model logo. */
    reset?: boolean;
}): Promise<Response> {
    const id = String(opts.agentId ?? "");
    try {
        if (opts.reset) await ctx.fns.chat.setIcon({ id, reset: true });
        else if (String(opts.svg ?? "").trim()) await ctx.fns.chat.setIcon({ id, svg: String(opts.svg) });
        else if (String(opts.emoji ?? "").trim()) await ctx.fns.chat.setIcon({ id, emoji: String(opts.emoji), background: opts.background });
        else throw new Error("Type an emoji or paste SVG");
    } catch (error: any) {
        const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
        const again = await ctx.fns.chat.iconPopup({ agentId: id });
        const body = (await again.text()).replace('<div class="space-y-4">', `<div class="space-y-4"><div class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">${esc(error?.message ?? error)}</div>`);
        return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("", { status: 200, headers: { "HX-Refresh": "true" } });
}
