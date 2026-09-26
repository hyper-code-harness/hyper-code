/**
 * Popup to add or edit a Hyper node (name, url, token) or remove it
 * @param opts.name Existing node name to edit; omit to add a new one.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Existing node name. */ name?: string }): Promise<string> {
    const esc = (x: any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const node = opts.name ? await ctx.fns.node.get({ name: opts.name }) : null;
    const html = `<form hx-popup="node.saveFromPopup" class="space-y-3">
      <p class="text-2xs text-muted">Models of that Hyper appear as <code>hyper/&lt;name&gt;:&lt;model&gt;</code>. Ask its owner for a token (LLMs → Shared with → Issue token).</p>
      <label class="block text-2xs font-medium">Name<input name="name" required value="${esc(node?.name ?? "")}" ${node ? "readonly" : ""} placeholder="niquola" pattern="[A-Za-z][\\w\\-.]{0,31}" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>
      <label class="block text-2xs font-medium">URL<input name="url" required value="${esc(node?.url ?? "")}" placeholder="http://127.0.0.1:3010/node/v1" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>
      <label class="block text-2xs font-medium">Token<input name="token" type="password" autocomplete="off" placeholder="${node ? "•••••• (unchanged)" : "token from the host"}" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>
      <div class="flex justify-end gap-2">${node ? ctx.fns.procs.ui.button({ action: "remove-node", label: "Remove", tone: "danger", size: "sm", name: "remove", value: "1" }) : ""}${ctx.fns.procs.ui.button({ action: "save-node", label: node ? "Save" : "Add", type: "submit", tone: "primary", size: "sm" })}</div>
    </form>`;
    return ctx.fns.ui.popupContent({ title: node ? `Node hyper/${node.name}` : "Add Hyper node", kind: "login", html });
}
