/** List explicitly enabled SSH aliases; does not connect or inspect credentials. */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string[]> {
    const value = await ctx.fns.settings.getString({ module: 'llm', scopeType: 'global', key: 'sshCliHosts', fallback: '' });
    const hosts = [...new Set((value ?? '').split(',').map(s => s.trim()).filter(Boolean))];
    if (hosts.some(h => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(h))) throw new Error('Invalid SSH CLI alias setting');
    return hosts;
}
