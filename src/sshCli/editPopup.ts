/** Show an owner-only native popup to enable existing OpenSSH aliases for Codex and Claude inference. */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    ctx.fns.sshCli.authorize({});
    const hosts = await ctx.fns.sshCli.hosts({});
    const aliases = (await ctx.fns.remote.servers({})).map(s => s.name).filter(s => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(s));
    const esc = (s: string) => ctx.fns.procs.ui.escape({ text: s });
    const html = `<form hx-popup="sshCli.saveFromPopup" class="space-y-4">
<p class="text-xs text-muted">Enter comma-separated SSH config aliases. Available: ${esc(aliases.join(', ') || 'none')}. Empty disables all instances. No SSH connection is opened by Save.</p>
<label class="block text-xs">Enabled aliases<input name="hosts" value="${esc(hosts.join(', '))}" class="input input-bordered input-sm mt-1 w-full font-mono" placeholder="gpu, work"></label>
<p class="text-xs text-muted">First verify the host key out of band. Create private isolated directories and log in remotely (clear ambient API keys): <code>env -u OPENAI_API_KEY -u CODEX_API_KEY -u CODEX_HOME HOME="$HOME/.hyper/ssh-accounts/codex/default" codex login</code>. For Claude: <code>env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CONFIG_DIR HOME="$HOME/.hyper/ssh-accounts/claude-code/default" claude auth login</code>. Requires Linux file credentials and Python 3. Ambient ~/.codex and ~/.claude credentials are never used. Select the corresponding ssh-codex or ssh-claude-code model in the model picker. Inference uses provider HTTP with remotely refreshed CLI credentials, not a CLI subprocess per prompt.</p>
<p class="text-xs text-muted">Only inference is supported: no remote login UI, quota polling or compaction. Model picker entries are curated, not a connectivity check.</p>
${ctx.fns.procs.ui.button({ action: 'save-ssh-cli', label: 'Save instances', type: 'submit', tone: 'primary', size: 'sm' })}</form>`;
    return ctx.fns.ui.popupContent({ title: 'SSH CLI instances', kind: 'login', html });
}
