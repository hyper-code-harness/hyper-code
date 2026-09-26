/** Popup to issue a token for another Hyper instance (name + allowed providers). */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const esc = (x: any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const all = await ctx.fns.llm.listModels({ skipNodes: true });
    const providers = Object.keys(all).filter((p) => p !== "lmstudio" && p !== "mock").map((p) => p.split("/")[0]!).filter((v, i, a) => a.indexOf(v) === i);
    const boxes = providers.map((p) => `<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="providers" value="${esc(p)}" checked class="checkbox checkbox-xs"><span class="font-mono">${esc(p)}</span></label>`).join("");
    const html = `<form hx-popup="node.issueFromPopup" class="space-y-3">
      <p class="text-2xs text-muted">The token is shown once. The other Hyper adds it under LLMs → Hyper nodes.</p>
      <label class="block text-2xs font-medium">Client name<input name="name" required placeholder="anna" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>
      <fieldset class="space-y-1"><legend class="text-2xs font-medium">Providers it may use</legend>${boxes}</fieldset>
      <div class="flex justify-end">${ctx.fns.procs.ui.button({ action: "issue-node-token", label: "Issue token", type: "submit", tone: "primary", size: "sm" })}</div>
    </form>`;
    return ctx.fns.ui.popupContent({ title: "Share your models with another Hyper", kind: "login", html });
}
