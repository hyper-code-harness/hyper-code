// Unified LLM connections surface. Managed Anthropic OAuth is fully wired;
// other providers retain their existing settings/login flows.
/** Handles the HTTP route  GET endpoint. */
export default async function (ctx: Context, _session: Session | null, _opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: String(s ?? "") });
    const status = await ctx.fns.settings.status({});
    const oauth = status.anthropicOAuth;
    const pending: any = [...((ctx.state as any).llm?.anthropicOAuth?.pending?.values?.() ?? [])]
        .find((p: any) => p.expiresAt > Date.now() && (p.status === "pending" || p.status === "exchanging"));
    // authorizationUrl contains only public OAuth request values (state and
    // challenge). The verifier and credentials never leave procedure state.
    const authorizationUrl = pending?.authorizationUrl ? String(pending.authorizationUrl) : null;
    const connected = [
        status.codex.loggedIn, status.kimiCoding.loggedIn, oauth.connected,
        status.openai.set, status.anthropic.set, status.openrouter.set,
    ].filter(Boolean).length;

    const badge = (on: boolean, label?: string) => on
        ? `<span class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-2xs font-medium text-success ring-1 ring-inset ring-success/30"><span class="size-1.5 rounded-full bg-success/100"></span>${esc(label ?? "connected")}</span>`
        : `<span class="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-1 text-2xs text-subtle ring-1 ring-inset ring-base-300"><span class="size-1.5 rounded-full bg-base-300"></span>${esc(label ?? "not connected")}</span>`;
    const settingsLink = (text: string) => `<a href="/settings" class="inline-flex rounded-md border border-base-300 bg-base-100 px-3 py-1.5 text-xs text-muted hover:bg-base-200">${esc(text)}</a>`;
    const staticCard = (opts: { icon: string; name: string; description: string; on: boolean; detail?: string; methods: string[] }) => `
<article class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="flex items-start gap-3">
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-lg text-muted"><i class="ph ${opts.icon}"></i></div>
    <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold text-base-content">${esc(opts.name)}</h2>${badge(opts.on, opts.detail)}</div><p class="mt-1 text-xs leading-5 text-subtle">${esc(opts.description)}</p></div>
  </div>
  <div class="mt-4 flex flex-wrap gap-2">${opts.methods.map((m) => settingsLink(m)).join("")}</div>
</article>`;

    // Fetch live quota for the connection page rather than waiting until each
    // account happens to complete an LLM turn. Failures stay per-account inside
    // refreshUsage, so one unavailable provider never breaks /llms.
    const inventory = await ctx.fns.llm.listAccounts({}).catch(() => [] as any[]);
    await ctx.fns.llm.refreshUsage({ accounts: inventory.map((a: any) => ({ provider: a.provider, account: a.account })) }).catch(() => undefined);
    const accounts = await ctx.fns.llm.listAccounts({}).catch(() => inventory);
    const logins = ctx.fns.llm.accountLoginStatus?.({}) ?? [];

    const oauthLabel = oauth.needsReconnect ? "reconnect required" : oauth.connected ? expiryLabel(oauth.expiresAt) : oauth.loginStatus === "pending" ? "login pending" : undefined;
    const oauthError = oauth.error
        ? `<div role="alert" class="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">${esc(oauth.error)}</div>` : "";
    const pendingPanel = pending ? `
<div class="mt-4 rounded-lg border border-info/30 bg-info/10 p-3 text-xs leading-5 text-info-content">
  <div class="font-semibold">Authorization in progress</div>
  <p class="mt-1">Complete sign-in in the Anthropic tab. ${pending.callbackListening ? "The local callback is listening." : "The local callback is unavailable; use the manual fallback below."}</p>
  ${authorizationUrl ? `<a class="mt-2 inline-flex rounded-md border border-info/40 bg-base-100 px-3 py-1.5 font-medium text-info hover:bg-info/15" target="_blank" rel="noreferrer" href="${esc(authorizationUrl)}">Open Anthropic authorization</a>` : ""}
  <form method="POST" action="/llms/anthropic-oauth/complete" class="mt-3 space-y-2">
    <label for="anthropic-authorization" class="block font-medium">Paste the final redirect URL or authorization code</label>
    <div class="flex flex-col gap-2 sm:flex-row"><input id="anthropic-authorization" name="authorization" required autocomplete="off" spellcheck="false" placeholder="http://localhost:53692/callback?code=…&state=…" class="min-w-0 flex-1 rounded-md border border-info/30 bg-base-100 px-3 py-2 font-mono text-xs">${ctx.fns.procs.ui.button({ action: 'complete-oauth', label: 'Complete connection', type: 'submit', tone: 'primary' })}</div>
    <p class="text-2xs text-blue-700">Use this when the callback opened on another machine or localhost could not be reached.</p>
  </form>
</div>` : "";
    // Adding a SECOND Claude login needs a name for the slot — without it the
    // callback would overwrite the first one, which is exactly the bug this
    // page had.
    const addAccountForm = `
<form method="POST" action="/llms/anthropic-oauth/connect" class="flex flex-wrap items-center gap-2">
  <input name="account" required pattern="[\\w.-]{1,40}" placeholder="имя аккаунта, например personal" class="w-56 rounded-md border border-base-300 bg-base-100 px-2 py-1.5 font-mono text-xs" aria-label="Account slot">
  <input name="label" placeholder="подпись (необязательно)" class="w-48 rounded-md border border-base-300 bg-base-100 px-2 py-1.5 text-xs" aria-label="Account label">
  ${ctx.fns.procs.ui.button({ action: 'add-claude-account', label: 'Add Claude account', type: 'submit' })}
</form>`;

    const oauthActions = oauth.connected ? `
<form method="POST" action="/llms/anthropic-oauth/connect"><input type="hidden" name="account" value="default">${ctx.fns.procs.ui.button({ action: 'reconnect-claude', label: oauth.needsReconnect ? "Reconnect" : "Reconnect main account", type: 'submit', tone: 'primary' })}</form>
${addAccountForm}` : `
<form method="POST" action="/llms/anthropic-oauth/connect"><input type="hidden" name="account" value="default">${ctx.fns.procs.ui.button({ action: 'connect-claude', label: pending ? "Restart connection" : "Connect Claude Pro / Max", type: 'submit', tone: 'primary' })}</form>`;

    const oauthCard = `<article class="rounded-xl border ${oauth.connected ? "border-emerald-200" : "border-base-300"} bg-base-100 p-4 shadow-sm md:col-span-2">
  <div class="flex items-start gap-3"><div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-lg text-violet-700"><i class="ph ph-sparkle"></i></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold text-base-content">Anthropic subscription</h2>${badge(oauth.connected && !oauth.needsReconnect, oauthLabel)}</div><p class="mt-1 text-xs leading-5 text-subtle">Claude Pro or Max through managed OAuth. Agents use the <code>anthropic-oauth:</code> model prefix.</p></div></div>
  ${oauthError}${pendingPanel}
  <div class="mt-4 flex flex-wrap gap-2">${oauthActions}</div>
  ${oauth.connected ? `<p class="mt-3 text-2xs text-faint">Каждый аккаунт — своя квота и свой префикс модели: <code>anthropic-oauth:</code> для основного, <code>anthropic-oauth/имя:</code> для остальных. Disconnect удаляет только один аккаунт и не трогает сессии в Claude.</p>` : ""}
</article>`;

    const main = `<div class="min-h-full bg-base-200">
<header class="border-b border-base-300 bg-base-100 px-6 py-5"><div class="mx-auto flex max-w-5xl items-start justify-between gap-4"><div><h1 class="text-xl font-semibold tracking-tight text-base-content">LLM connections</h1><p class="mt-1 text-sm text-subtle">Connect subscription accounts with +, or configure pay-per-token API providers.</p></div><div class="rounded-lg bg-base-200 px-3 py-2 text-right ring-1 ring-base-300"><div class="text-lg font-semibold text-base-content">${accounts.length}</div><div class="text-3xs uppercase tracking-wide text-faint">accounts</div></div></div></header>
<div class="mx-auto max-w-5xl space-y-7 px-6 py-6">
${ctx.fns.llms.accountsCard({ accounts, logins })}
<section><div class="mb-3"><h2 class="text-xs font-semibold uppercase tracking-wider text-subtle">API providers</h2><p class="mt-1 text-xs text-faint">Pay-per-token keys are managed separately from subscription accounts.</p></div><div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">${staticCard({ icon: "ph-sparkle", name: "Anthropic API", description: "Claude models billed through an Anthropic API key.", on: status.anthropic.set, methods: [status.anthropic.set ? "Manage key in Settings" : "Add key in Settings"] })}${staticCard({ icon: "ph-circles-three-plus", name: "OpenAI", description: "OpenAI platform models and billing.", on: status.openai.set, methods: [status.openai.set ? "Manage key in Settings" : "Add key in Settings"] })}${staticCard({ icon: "ph-git-fork", name: "OpenRouter", description: "Multiple model vendors through one API.", on: status.openrouter.set, methods: [status.openrouter.set ? "Manage key in Settings" : "Add key in Settings"] })}</div></section>
</div></div>`;
    return { title: "LLMs", main };
}

function expiryLabel(expiresAt: number | null): string {
    if (!expiresAt) return "connected";
    const ms = expiresAt - Date.now();
    if (ms <= 0) return "reconnect required";
    const mins = Math.ceil(ms / 60_000);
    return mins < 120 ? `connected · ${mins}m` : `connected · ${Math.ceil(mins / 60)}h`;
}
