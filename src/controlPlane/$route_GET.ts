/** "Hyper instances": every Hyper registered in the control plane, with owner and last heartbeat. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg) {
        return { title: "Hyper instances", main: `<div class="mx-auto max-w-3xl p-6"><h1 class="mb-2 text-lg font-semibold">Hyper instances</h1><p class="text-sm text-muted">This Hyper is not connected to a Hyper Control Plane. Set <code>HYPER_OIDC_ISSUER</code>, <code>HYPER_OIDC_CLIENT_ID</code> and <code>HYPER_OIDC_CLIENT_SECRET</code>.</p></div>` };
    }
    const services = await ctx.fns.controlPlane.services({ kind: "hyper" });
    const ago = (t: number | null) => {
        if (!t) return "never";
        const m = Math.round((Date.now() - t) / 60000);
        return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
    };
    const alive = (t: number | null) => t != null && Date.now() - t < 15 * 60000;
    const rows = services.map((s) => {
        const m: any = s.metadata ?? {};
        return `<tr class="border-b border-base-200" data-service="${esc(s.id)}">
  <td class="py-2 pr-3"><span class="mr-2 inline-block size-2 rounded-full ${alive(s.lastSeenAt) ? "bg-success" : "bg-base-300"}"></span><a class="font-medium hover:underline" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><div class="ml-4 text-3xs text-faint">${esc(s.url)}</div></td>
  <td class="py-2 pr-3 text-xs">${esc(s.ownerEmail ?? "—")}</td>
  <td class="py-2 pr-3 text-xs">${m.users ?? "—"} people · ${m.agents ?? "—"} agents${m.running ? ` · ${esc(m.running)} running` : ""}</td>
  <td class="py-2 pr-3 font-mono text-3xs text-faint">${esc(m.version ?? "")}</td>
  <td class="py-2 text-right text-xs text-faint">${esc(ago(s.lastSeenAt))}</td></tr>`;
    }).join("");
    const main = `<div class="mx-auto w-full max-w-5xl p-6">
  <h1 class="mb-1 text-lg font-semibold">Hyper instances</h1>
  <p class="mb-4 text-xs text-muted">Registered in the control plane <code>${esc(cfg.issuer)}</code>.</p>
  ${services.length ? `<table class="w-full text-left text-sm"><thead><tr class="border-b border-ui-border text-3xs uppercase tracking-wider text-faint"><th class="pb-1">Hyper</th><th class="pb-1">Owner</th><th class="pb-1">Size</th><th class="pb-1">Version</th><th class="pb-1 text-right">Last seen</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="text-sm text-muted">No instances visible (control plane unreachable, or none registered).</p>`}
</div>`;
    return { title: "Hyper instances", main };
}
