/** Enable an explicit list of configured SSH aliases; never connects or copies credentials.
 * @param opts.hosts Comma-separated SSH config aliases; empty disables all SSH CLI models.
 */
export default async function (ctx: Context, session: Session | null, opts: { /** Comma-separated aliases; empty disables all. */ hosts: string }): Promise<string> {
    ctx.fns.sshCli.authorize({});
    if (session?.req) {
        const req = session.req;
        if (req.method !== 'POST' || req.headers.get('origin') !== new URL(req.url).origin) throw new Error('Same-origin POST required');
    }
    const hosts = [...new Set(opts.hosts.split(',').map(s => s.trim()).filter(Boolean))];
    if (hosts.some(h => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(h))) throw new Error('Invalid SSH alias');
    const available = await ctx.fns.remote.servers({});
    if (hosts.some(h => !available.some(s => s.name === h))) throw new Error('SSH alias is not declared in the OpenSSH config');
    await ctx.fns.settings.set({ module: 'llm', scopeType: 'global', key: 'sshCliHosts', value: hosts.join(',') });
    // Model discovery normally caches for one minute. Explicit reconfiguration invalidates it.
    (ctx.state as { llmModelCatalog?: object }).llmModelCatalog = {};
    return ctx.fns.ui.popupContent({ title: 'SSH instances saved', kind: 'login', html: '<p class="text-sm">Configuration saved. Remote login was not tested. Reload LLM connections to view the instances.</p>' });
}
