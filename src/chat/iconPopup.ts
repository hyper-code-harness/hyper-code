/**
 * Opens the icon editor of a chat in the app popup: an emoji on a colour, pasted SVG, or back to the model logo.
 * @param opts.agentId Agent whose icon changes.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose icon changes. */
    agentId: string;
}): Promise<Response> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const id = String(opts.agentId ?? "");
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("agent not found", { status: 404 });
    const params = (extra: Record<string, unknown>) => esc(JSON.stringify({ agentId: id, ...extra }));
    const colours = ["#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#334155"];
    const swatches = colours.map((c, i) => `<label class="cursor-pointer"><input type="radio" name="background" value="${c}" class="peer sr-only"${i === 0 ? " checked" : ""}><span class="block size-6 rounded-full ring-offset-2 ring-offset-base-100 peer-checked:ring-2 peer-checked:ring-primary" style="background:${c}"></span></label>`).join("");
    const html = `<div class="space-y-4">
  <div class="flex items-center gap-3">${ctx.fns.chat.icon({ icon: agent.icon, model: agent.model, size: "lg" })}<div class="text-xs text-faint">Shown in the chat header, Dock pins and chat lists.</div></div>
  <form hx-popup="chat.saveIcon" hx-popup-params='${params({})}' class="space-y-2 rounded-xl border border-ui-border p-3">
    <div class="text-xs font-medium text-muted">Emoji or letters</div>
    <div class="flex items-center gap-2"><input name="emoji" maxlength="8" placeholder="🦊" class="w-20 rounded-lg border border-ui-input bg-base-100 px-3 py-2 text-center text-lg"><div class="flex flex-wrap gap-1.5">${swatches}</div></div>
    ${ctx.fns.w.button({ label: "Use emoji", tone: "primary", size: "md", submit: true, marks: { action: "save-icon-emoji" } })}
  </form>
  <form hx-popup="chat.saveIcon" hx-popup-params='${params({})}' class="space-y-2 rounded-xl border border-ui-border p-3">
    <div class="text-xs font-medium text-muted">SVG</div>
    <textarea name="svg" rows="5" placeholder='&lt;svg viewBox="0 0 32 32"&gt;…&lt;/svg&gt;' class="block w-full rounded-lg border border-ui-input bg-base-100 p-2 font-mono text-3xs">${esc(agent.icon ?? "")}</textarea>
    <div class="text-3xs text-faint">Up to 8 KB. Scripts, links and embedded images are removed.</div>
    ${ctx.fns.w.button({ label: "Use SVG", tone: "primary", size: "md", submit: true, marks: { action: "save-icon-svg" } })}
  </form>
  ${agent.icon ? `<form hx-popup="chat.saveIcon" hx-popup-params='${params({ reset: true })}'>${ctx.fns.w.button({ label: "Back to model logo", size: "md", submit: true, marks: { action: "reset-icon" } })}</form>` : ""}
</div>`;
    return new Response(ctx.fns.ui.popupContent({ title: `Icon · ${agent.title || id}`, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
}
