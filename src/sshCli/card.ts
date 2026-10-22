/** Render the upstream-native SSH CLI connection section; configured does not mean authenticated. */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const hosts = await ctx.fns.sshCli.hosts({});
    const heading = ctx.fns.procs.ui.heading({ title: 'SSH instances · CLI subscriptions', meta: 'Use Codex CLI and Claude Code CLI credentials on another Linux host without copying its credentials or installing Hyper there.', actions: ctx.fns.ui.popup({ method: 'sshCli.editPopup', params: {}, size: 'sm', tone: 'default', html: '<span>Configure SSH instances</span>' }) });
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    const rows = hosts.map(host => ctx.fns.procs.ui.row({ entity: 'ssh-cli', id: host, status: 'neutral', cells: [
        { role: 'connection', class: 'min-w-0 flex-1', html: `<span class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
<span class="min-w-0 break-all font-mono text-xs sm:w-40 sm:shrink-0" ${ctx.fns.procs.ui.attr({ role: 'name' })}>${esc(host)}</span>
<span class="min-w-0 flex-1 break-all font-mono text-xs" ${ctx.fns.procs.ui.attr({ role: 'model' })}>${esc(`ssh-codex/${host}:gpt-5.4 · ssh-claude-code/${host}:claude-sonnet-4-6`)}</span>
<span class="text-2xs text-muted sm:w-40 sm:shrink-0" ${ctx.fns.procs.ui.attr({ role: 'status' })}>Configured · remote login not checked</span>
</span>` },
    ] })).join('');
    return `<section>${heading}<div class="mt-2 overflow-hidden rounded-xl border border-ui-border bg-base-100">${rows || ctx.fns.procs.ui.empty({ title: 'No SSH instances enabled', text: 'Choose an existing OpenSSH alias. Manual isolated remote CLI login is required.' })}</div><p class="mt-2 text-xs text-muted">Experimental: Codex and Claude inference only. No usage polling or compaction. Start a new chat when context fills.</p></section>`;
}
