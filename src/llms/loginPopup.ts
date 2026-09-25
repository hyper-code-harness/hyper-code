/** Renders the typed account-login popup loaded by the global popup RPC. */
/**
 * Render a provider-specific login form and any in-progress authorization state.
 *
 * Claude Code explains that its official browser auth will open and credentials
 * remain in a provider-owned keychain service. Codex presents the device URL and
 * code once the flow starts. No verifier or token is ever rendered.
 *
 * @param opts.provider Provider whose login popup is being opened.
 * @param opts.flow Optional safe progress state from llm.accountLoginStatus.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Provider login type. */ provider: "claude-code" | "codex" | "xai";
    /** Safe login progress, never credentials. */ flow?: { account: string; status: "pending" | "connected" | "failed"; verificationUri: string | null; userCode: string | null; error: string | null } | null;
    /** Existing account slot to reconnect. */ account?: string;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: String(s ?? "") });
    const button = (action: string, label: string, tone: "default" | "primary" = "default", cls = "") => ctx.fns.llms?.popupButton
        ? ctx.fns.llms.popupButton({ action, label, tone, class: cls })
        : ctx.fns.procs.ui.button({ action, label, type: "submit", tone, class: cls });
    const claude = opts.provider === "claude-code";
    const xai = opts.provider === "xai";
    const accountValue = opts.account ? ` value="${esc(opts.account)}"` : '';
    const accountReadonly = opts.account ? ' readonly' : '';
    const title = opts.account ? `Reconnect ${opts.account}` : claude ? "Add Claude Code account" : xai ? "Add Grok account" : "Add Codex account";
    const flow = opts.flow;
    if (flow) return `<div class="space-y-3">
      <div class="rounded-lg border ${flow.status === "failed" ? "border-error/30 bg-error/10" : "border-info/30 bg-info/10"} p-3 text-xs">
        <div class="font-semibold">${esc(flow.account)} · ${esc(flow.status)}</div>
        ${claude && flow.status === "pending" ? `<p class="mt-1 text-subtle">Finish signing in in the Claude browser tab. The credential is saved by Claude Code in an isolated macOS Keychain service.</p>` : ""}
        ${flow.verificationUri ? `<div class="mt-3 rounded-lg border border-ui-border bg-base-100 p-3 text-center">${ctx.fns.procs.ui.button({ action: 'open-authorization-page', label: 'Open authorization page', href: flow.verificationUri, tone: 'primary', attrs: { target: '_blank', rel: 'noreferrer' } })}${flow.userCode ? `<div class="mt-3 text-3xs uppercase tracking-wide text-faint">Enter this one-time code</div><div class="mt-1 flex items-center justify-center gap-2"><code class="select-all rounded-md bg-base-200 px-4 py-2 font-mono text-xl font-semibold tracking-widest text-base-content">${esc(flow.userCode)}</code>${ctx.fns.procs.ui.button({ action: 'copy-login-code', label: 'Copy', attrs: { 'data-copy-code': flow.userCode, onclick: "navigator.clipboard?.writeText(this.dataset.copyCode);this.textContent='Copied'" } })}</div>` : ""}</div>` : ""}
        ${claude && flow.status === "pending" ? `<form hx-popup="llms.submitLoginCode" hx-popup-params="${esc(JSON.stringify({ provider: "claude-code", account: flow.account }))}" class="mt-3 space-y-2"><label class="block text-2xs font-medium">One-time code from Claude<input name="code" autocomplete="one-time-code" required placeholder="Paste code from the browser" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>${button("submit-claude-code", "Submit code", "primary", "w-full")}<p class="text-3xs text-faint">Sent directly to Claude CLI stdin; never stored.</p></form>` : ""}
        ${flow.error ? `<p class="mt-1 text-error">${esc(flow.error)}</p>` : ""}
      </div>
      <p class="text-2xs text-faint">This popup may be closed; login continues in the background and the account list updates automatically.</p>
    </div>`;
    return `<div class="space-y-4">
      <div><h3 class="text-sm font-semibold">${title}</h3><p class="mt-1 text-xs leading-5 text-subtle">${claude ? "Choose how to connect this Claude subscription account. Managed OAuth is recommended for multiple accounts; Claude Code CLI keeps the credential in its own Keychain service." : xai ? "Starts xAI managed device OAuth. The next popup safely shows only the public authorization URL and one-time code." : "Starts `codex login --device-auth` in an isolated CODEX_HOME. The next popup shows the device URL and code."}</p></div>
      ${claude ? `<div class="grid gap-2 sm:grid-cols-2">
        <form hx-popup="llms.startClaudeManagedOAuth" class="rounded-lg border border-primary/35 bg-primary/5 p-3">
          <input name="account" required pattern="[\\w.-]{1,40}" placeholder="work or personal"${accountValue}${accountReadonly} class="input input-bordered input-sm w-full font-mono text-xs">
          <div class="mt-2 text-xs font-semibold">Managed OAuth <span class="text-primary">recommended</span></div><p class="mt-1 text-3xs leading-4 text-faint">Hyper handles PKCE and encrypts tokens in Postgres. Best for several accounts.</p>
          ${button("start-managed-oauth", "Continue", "primary", "mt-2 w-full")}
        </form>
        <form hx-popup="llms.startLoginFromPopup" hx-popup-params="${esc(JSON.stringify({ provider: opts.provider }))}" class="rounded-lg border border-base-300 p-3">
          <input name="account" required pattern="[\\w.-]{1,40}" placeholder="work or personal"${accountValue}${accountReadonly} class="input input-bordered input-sm w-full font-mono text-xs">
          <div class="mt-2 text-xs font-semibold">Claude Code CLI</div><p class="mt-1 text-3xs leading-4 text-faint">Runs the official CLI in an isolated config directory. Token stays in Keychain.</p>
          ${button("start-claude-cli", "Start CLI login", "default", "mt-2 w-full")}
        </form>
      </div>` : `<form hx-popup="llms.startLoginFromPopup" hx-popup-params="${esc(JSON.stringify({ provider: opts.provider }))}" class="space-y-3">
        <label class="block text-xs font-medium">Account name<input autofocus name="account" required pattern="[\\w.-]{1,40}" placeholder="work or personal"${accountValue}${accountReadonly} class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>
        ${button(xai ? "start-xai-login" : "start-codex-login", xai ? "Start Grok login" : "Start Codex login", "primary", "w-full")}
      </form>`}
      <div class="rounded-md bg-base-200 px-3 py-2 text-3xs leading-4 text-faint"><i class="ph ph-lock-key mr-1"></i>No access or refresh token is rendered in this popup or written to a transcript.</div>
    </div>`;
}
