/** Handles the HTTP route  GET endpoint. */
export default async function (ctx: Context, _session: Session | null, _opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const s = await ctx.fns.settings.status({});
    const kc = (ctx.state as any).settings?.kimi;
    const cx = (ctx.state as any).settings?.codex;
    const expHuman = (e: number | null) =>
        e ? `${Math.max(0, e - Math.floor(Date.now() / 1000))}s left` : "—";

    const envRow = (label: string, key: string, set: boolean, hint = "") => `
<form method="POST" action="/settings/env" class="flex flex-wrap items-center gap-2 py-2 border-b border-base-200">
  <input type="hidden" name="key" value="${key}">
  <span class="w-32 shrink-0 text-sm font-mono text-muted">${esc(label)}</span>
  <input type="password" name="value" placeholder="${set ? "(set — paste to replace)" : "paste key"}"
    class="min-w-40 flex-1 px-2 py-1 text-xs font-mono border border-base-300 rounded bg-base-100">
  <span class="text-xs ${set ? "text-success" : "text-faint"}">${set ? "✓ set" : "—"}</span>
  ${ctx.fns.procs.ui.button({ action: 'save-env', label: 'save', size: 'xs' })}
  ${hint ? `<span class="basis-full text-xs text-faint sm:basis-auto">${esc(hint)}</span>` : ""}
</form>`;

    const loginBox = (state: any, host: string): string => {
        if (state?.status === "pending" && state.verificationUri && state.userCode) {
            const url = state.verificationUriComplete ?? state.verificationUri;
            return `<div class="rounded border border-info/30 bg-info/10 px-4 py-3 text-sm mt-3">
  <div class="font-semibold mb-1">Authorize on ${esc(host)}</div>
  <div class="mb-2">Open <a class="text-info underline" target="_blank" href="${esc(url)}">${esc(url)}</a> and enter code <code class="px-1 bg-base-100 border rounded font-mono">${esc(state.userCode)}</code>.</div>
  <div class="text-xs text-subtle">Polling — page auto-refreshes.</div>
</div>
<script>setTimeout(() => location.reload(), 3000);</script>`;
        }
        if (state?.status === "failed") {
            return `<div class="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error mt-3">login failed: ${esc(state.error ?? "")}</div>`;
        }
        if (state?.status === "expired") {
            return `<div class="rounded border border-warning/30 bg-warning/10 px-4 py-3 text-sm mt-3">device code expired — start again.</div>`;
        }
        return "";
    };

    const main = `<div class="flex-1 overflow-y-auto">
<div class="max-w-3xl mx-auto px-6 py-6 space-y-6">
  <h1 class="text-xl font-semibold text-muted">Settings</h1>

  <section>
    <h2 class="text-sm font-semibold text-muted mb-2">API keys (provider-prefixed models)</h2>
    <p class="text-xs text-subtle mb-2">Saved into <code>.env</code> and applied to the running process.</p>
    ${envRow("OpenAI", "OPENAI_API_KEY", s.openai.set, "openai:gpt-…")}
    ${envRow("Anthropic", "ANTHROPIC_API_KEY", s.anthropic.set, "anthropic:claude-…")}
    ${envRow("Kimi (Moonshot)", "KIMI_API_KEY", s.kimi.set, "kimi:kimi-k2-…")}
    ${envRow("Groq", "GROQ_API_KEY", s.groq.set, "groq:llama-…")}
    ${envRow("OpenRouter", "OPENROUTER_API_KEY", s.openrouter.set, "openrouter:…")}
  </section>

  <section>
    <h2 class="text-sm font-semibold text-muted mb-2">Kimi coding subscription <span class="font-mono text-xs text-faint">(kimi-coding:…)</span></h2>
    <p class="text-xs text-subtle mb-2">OAuth device flow — same credential file that <code>kimi</code> CLI uses (<code>~/.kimi/credentials/kimi-code.json</code>). Access tokens auto-refresh.</p>
    <div class="flex items-center gap-3 py-2 border-b border-base-200">
      <span class="text-sm">${s.kimiCoding.loggedIn ? "✓ logged in" : "— not logged in"}</span>
      <span class="text-xs text-faint font-mono">${s.kimiCoding.loggedIn ? expHuman(s.kimiCoding.expSec) : ""}</span>
      <span class="flex-1"></span>
      <form method="POST" action="/settings/kimi/login" class="inline">
        ${ctx.fns.procs.ui.button({ action: 'kimi-login', label: s.kimiCoding.loggedIn ? 're-login' : 'login', size: 'xs' })}
      </form>
      ${s.kimiCoding.loggedIn ? `<form method="POST" action="/settings/kimi/logout" class="inline">
        ${ctx.fns.procs.ui.button({ action: 'logout', label: 'logout', size: 'xs' })}
      </form>` : ""}
    </div>
    ${loginBox(kc, "auth.kimi.com")}
  </section>

  <section>
    <h2 class="text-sm font-semibold text-muted mb-2">Codex (ChatGPT subscription)</h2>
    <p class="text-xs text-subtle mb-2">Spawns <code>codex login --device-auth</code>; tokens land in <code>~/.codex/auth.json</code> (same file the <code>codex</code> CLI uses).</p>
    <p class="text-xs text-subtle mb-2">Once logged in, create new agents with model prefix <code>codex:</code> (e.g. <code>codex:gpt-5.4</code>) — they hit <code>chatgpt.com/backend-api/codex</code> through your subscription, no per-token billing. The dropdown on <a href="/agent/new" class="underline">+ new</a> picks up codex models from the <code>/codex/models</code> whitelist. Note: <code>openai:</code> models (standard <code>api.openai.com</code>) still need a separate platform-key.</p>
    <div class="flex items-center gap-3 py-2 border-b border-base-200">
      <span class="text-sm">${s.codex.loggedIn ? "✓ logged in" : "— not logged in"}</span>
      <span class="text-xs text-faint font-mono">${s.codex.email ? esc(s.codex.email) + " · " + expHuman(s.codex.expSec) : ""}</span>
      <span class="flex-1"></span>
      <form method="POST" action="/settings/codex/login" class="inline">
        ${ctx.fns.procs.ui.button({ action: 'codex-login', label: s.codex.loggedIn ? 're-login' : 'login', size: 'xs' })}
      </form>
      ${s.codex.loggedIn ? `<form method="POST" action="/settings/codex/logout" class="inline">
        ${ctx.fns.procs.ui.button({ action: 'logout', label: 'logout', size: 'xs' })}
      </form>` : ""}
    </div>
    ${loginBox(cx, "auth.openai.com")}
  </section>
</div>
</div>`;
    return { title: "settings", main };
}

function esc(s: any): string {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}
