/**
 * Issue a client token from the popup and show it once with the URL to configure on the other Hyper
 * @param opts.name Client name.
 * @param opts.providers Allowed providers (checkbox values).
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Client name. */ name: string; /** Allowed providers. */ providers?: string | string[] }): Promise<string> {
    const esc = (x: any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const providers = ([] as string[]).concat(opts.providers ?? []).filter(Boolean);
    const all = Object.keys(await ctx.fns.llm.listModels({ skipNodes: true })).filter((p) => p !== "lmstudio" && p !== "mock").map((p) => p.split("/")[0]!);
    const restricted = providers.length && providers.length < new Set(all).size ? providers : [];
    const issued = await ctx.fns.node.issueClient({ name: opts.name, providers: restricted });
    ctx.fns.procs.events.refresh({ topic: "node-clients", reason: "issued" });
    const html = `<p class="text-2xs text-muted">Copy now — it will not be shown again.</p>
      <div class="mt-3 space-y-2 text-xs"><div><div class="text-3xs uppercase text-faint">URL</div><pre class="select-all rounded bg-base-300 p-2 font-mono text-xs">${esc(issued.url)}</pre></div>
      <div><div class="text-3xs uppercase text-faint">Token</div><pre class="select-all break-all rounded bg-base-300 p-2 font-mono text-xs">${esc(issued.token)}</pre></div></div>
      <p class="mt-2 text-3xs text-faint">On a tailnet replace 127.0.0.1 with this machine's Tailscale IP or name.</p>`;
    return ctx.fns.ui.popupContent({ title: `Token for ${issued.name}`, kind: "secure-input", html });
}
