/**
 * Renders plugin source providers and their configuration links.
 *
 * Use for the core sources page without remote catalogue requests or registry assumptions.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const esc=(v:unknown)=>Bun.escapeHTML(String(v??'')); const providers=await ctx.fns.plugins.providers({}); return '<link rel="stylesheet" href="/plugins/plugins.css"><div class="pl"><header class="pl-head"><div><h1>Plugin sources</h1><p class="pl-sub">Provider configuration</p></div><a class="pl-button" href="/plugins">Back to plugins</a></header><p class="pl-note">Filesystem is a built-in local source. Local folders are not remote releases; unmanaged or unverifiable sources cannot be overwritten through this page.</p><div class="pl-list">'+providers.map(p=>'<article class="pl-card"><div class="pl-body"><h2>'+esc(p.label)+'</h2><p>'+esc(p.description)+'</p><code>'+esc(p.id)+'</code></div>'+(p.configurationHref?'<a class="pl-button" href="'+esc(p.configurationHref)+'">Configure source</a>':'<span class="pl-badge">No configuration page</span>')+'</article>').join('')+'</div></div>';
}
