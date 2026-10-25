// One account surface grouped by provider. Credential storage is an adapter
// detail, never the information architecture of the page.
/** Renders subscription accounts consistently in provider-oriented groups. */
/**
 * Render one account list grouped by provider, independent of where each
 * credential is stored. Every provider uses the same row shape, plan/quota
 * fields and add-account action; storage ownership appears only as a secondary
 * badge and tooltip.
 *
 * @param opts.accounts Credential rows from llm.listAccounts.
 * @param opts.logins Safe progress state from llm.accountLoginStatus.
 * @param opts.now Current time in ms, for testing.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Rows produced by llm.listAccounts. */ accounts: Array<{ provider: string; account: string; label: string; model: string; source: "file" | "oauth" | "keychain" | "node"; available: boolean; usedPercent: number | null; planType: string | null; resetsAt: number | null; resetCredits?: types.llm.UsageSnapshot["resetCredits"]; parkedAgents: number; needsReconnect?: boolean }>;
    /** Login flows currently pending or recently completed. */ logins?: Array<{ provider: string; account: string; status: "pending" | "connected" | "failed"; verificationUri: string | null; userCode: string | null; error: string | null }>;
    /** Current timestamp in ms. */ now?: number;
}): string {
    const now = opts.now ?? Date.now();
    const esc = (x: any) => ctx.fns.w.escape({ text: String(x ?? "") });
    const prefix = (a: typeof opts.accounts[number]) => `${a.provider}${a.account === "default" ? "" : `/${a.account}`}:`;

    const remove = (a: typeof opts.accounts[number]) => {
        if (a.source !== "oauth" && a.account === "default") return "";
        return ctx.fns.w.button({ label: "Remove", icon: "trash", tone: "danger", size: "sm", action: { popup: { method: "llms.removeAccount", params: { provider: a.provider, account: a.account } } }, marks: { action: "open-popup" } });
    };
    const row = (a: typeof opts.accounts[number]) => {
        const used = a.usedPercent;
        const quota = !a.available ? `limit exhausted${a.resetsAt ? ` · resets ${humanDelay(a.resetsAt-now)}` : ""}` : used == null ? "usage unavailable" : `${Math.round(used)}% used · ${Math.round(100-used)}% left`;
        const status = !a.available || (used != null && used >= 75) ? "limit" : used != null && used >= 50 ? "warning" : "ready";
        const storage = storageLabel(a.source);
        const reconnect = a.needsReconnect
            ? ctx.fns.w.button({ label: "Reconnect", icon: "arrow-clockwise", tone: "warning", size: "sm", action: { popup: { method: "llms.loginPopupFor", params: { provider: a.provider === "anthropic-oauth" ? "claude-code" : a.provider, account: a.account } } }, marks: { action: "open-popup" } })
            : "";
        const resetCount = a.provider === "codex" ? a.resetCredits?.availableCount : undefined;
        const resetDetails = a.provider === "codex" && a.resetCredits?.credits?.length ? `<details class="text-3xs text-subtle"><summary class="cursor-pointer">details</summary><div class="absolute z-20 mt-1 max-w-xs space-y-1 rounded-lg border border-ui-border bg-base-100 p-2 shadow-xl">${a.resetCredits.credits.map((credit: any) => `<div><div class="font-medium text-muted">${esc(credit.title || credit.resetType || "Codex reset")}</div>${credit.description ? `<div>${esc(credit.description)}</div>` : ""}${credit.expiresAt ? `<div>expires ${esc(new Date(typeof credit.expiresAt === "number" ? (credit.expiresAt < 10_000_000_000 ? credit.expiresAt * 1000 : credit.expiresAt) : credit.expiresAt).toLocaleString())}</div>` : ""}</div>`).join("")}</div></details>` : "";
        const reset = a.provider === "codex" && resetCount != null ? `<form method="POST" action="/llms/codex/reset" hx-post="/llms/codex/reset" hx-target="find .reset-result" hx-swap="innerHTML" class="flex items-center gap-1" onsubmit="return confirm('Use one of ${resetCount} Codex reset credits now?')"><input type="hidden" name="account" value="${esc(a.account)}"><span class="reset-result text-3xs text-subtle">${resetCount} reset${resetCount === 1 ? "" : "s"}</span>${resetDetails}${resetCount > 0 ? ctx.fns.w.button({ label: "Reset limit", size: "sm", submit: true, marks: { action: "reset-codex-limit" } }) : ""}</form>` : "";
        const actions = `${reset}${reconnect}${remove(a)}`;
        return ctx.fns.w.record({ entity: "llm-account", id: `${a.provider}/${a.account}`, status: a.needsReconnect ? "error" : status, cells: [
            { role: "account", text: a.account === "default" ? "main" : a.account, width: "label", mix: { mono: true, weight: "strong" } },
            ...(a.planType ? [{ role: "plan", html: ctx.fns.w.badge({ text: planName(a.provider, a.planType) }), title: `Subscription plan: ${a.planType}` }] : []),
            { role: "prefix", text: prefix(a), title: prefix(a), grow: true, mix: { mono: true, text: "small", ink: "faint" } },
            { role: "storage", text: storage.text, title: storage.title, wide: true, mix: { text: "small", ink: "faint" } },
            { role: "quota", text: quota, tone: (status === "limit" ? "danger" : status === "warning" ? "warning" : "success") as "danger" | "warning" | "success", mix: { text: "small" as const } },
            ...(a.needsReconnect ? [{ role: "auth", text: "authentication required", tone: "danger" as const, mix: { text: "small" as const, weight: "strong" as const } }] : []),
            ...(a.parkedAgents ? [{ role: "parked", html: ctx.fns.w.badge({ text: `${a.parkedAgents} parked`, tone: "warning" }) }] : []),
        ], end: actions });
    };

    const providers = [
        { id: "codex", title: "Codex", icon: "codex:gpt", accounts: opts.accounts.filter(a => a.provider === "codex"), add: addButton(ctx, "codex", "Add Codex account") },
        { id: "claude", title: "Claude", icon: "claude-code:claude", accounts: opts.accounts.filter(a => a.provider === "claude-code" || a.provider === "anthropic-oauth"), add: addButton(ctx, "claude-code", "Add Claude account") },
        { id: "grok", title: "Grok", icon: "xai:grok", accounts: opts.accounts.filter(a => a.provider === "xai"), add: addButton(ctx, "xai", "Add Grok account") },
        { id: "kimi", title: "Kimi Coding", icon: "kimi-coding:k3", accounts: opts.accounts.filter(a => a.provider === "kimi-coding"), add: ctx.fns.w.button({ label: "+ Add account", size: "sm", marks: { action: "add-kimi" }, title: "Kimi multi-login is not wired yet", disabled: true }) },
    ];
    const providerSections = providers.map(p => {
        const heading = ctx.fns.w.heading({ title: p.title, lead: ctx.fns.ui.modelLogo?.({ model: p.icon, bare: true }) ?? "", meta: `${p.accounts.length} connected account${p.accounts.length === 1 ? "" : "s"}`, actions: p.add });
        const body = p.accounts.length ? p.accounts.map(row).join("") : ctx.fns.w.empty({ title: `No ${p.title} accounts`, icon: "tray", hint: "Use Add account to connect one." });
        return `<section data-provider="${p.id}">${heading}${ctx.fns.w.card({ body, flush: true })}</section>`;
    }).join("");

    const flowRows = (opts.logins ?? []).map(f => ctx.fns.w.record({ entity: "llm-login", id: `${f.provider}/${f.account}`, status: f.status, cells: [
        { role: "provider", text: providerName(f.provider), width: "label", mix: { weight: "strong" } },
        { role: "account", text: f.account, width: "label", mix: { mono: true } },
        { role: "status", text: f.status, tone: "info" },
        ...(f.userCode ? [{ role: "device-code", html: ctx.fns.w.kbd({ keys: f.userCode }) }] : []),
    ], end: ctx.fns.w.button({ label: "Continue login", tone: "neutral", size: "sm", action: { popup: { method: "llms.loginProgressFor", params: { provider: f.provider, account: f.account } } }, marks: { action: "open-popup" } }) })).join("");

    const flows = flowRows ? `<section>${ctx.fns.w.heading({ title: "Logins in progress", meta: "Safe authorization status only." })}${ctx.fns.w.card({ body: flowRows, flush: true })}</section>` : "";
    const html = ctx.fns.w.box({ body: providerSections + flows, mix: { layout: "stack", gap: "s6" } });
    // Morph, not replace: the 10 s refresh must not snap an open "details" shut.
    return ctx.fns.ui.live({ id: "llm-accounts", url: "/llms/accounts", topic: "llm-accounts", swap: "outerMorph", every: 10, attrs: 'class="block"', html });
}

function addButton(ctx: Context, provider: "claude-code" | "codex" | "xai", title: string): string {
    return ctx.fns.w.button({ label: title, icon: "plus", tone: "neutral", size: "sm", action: { popup: { method: "llms.loginPopupFor", params: { provider } } }, marks: { action: "open-popup" } });
}
function storageLabel(source:string){return source==="node"?{text:"Hyper node",title:"Relayed through another Hyper instance; only your client token is stored here"}:source==="oauth"?{text:"Encrypted by Hyper",title:"OAuth credential encrypted and stored by Hyper"}:source==="keychain"?{text:"Keychain",title:"Credential stored by the official CLI in macOS Keychain"}:{text:"CLI storage",title:"Credential stored in an isolated official CLI directory"};}
function providerName(p:string){return p==="hyper"?"Hyper node":p==="anthropic-oauth"?"Claude":p==="claude-code"?"Claude Code":p==="kimi-coding"?"Kimi Coding":p==="xai"?"Grok":p==="codex"?"Codex":p;}
function planName(provider:string, plan:string){const p=String(plan).toLowerCase();if(provider==="codex"&&p==="prolite")return "ChatGPT Go";return p==="pro"?"Pro":p==="max"?"Max":p==="team"?"Team":p==="enterprise"?"Enterprise":plan;}
function humanDelay(ms:number){const m=Math.floor(Math.max(0,ms)/60000),h=Math.floor(m/60),d=Math.floor(h/24);return d?`${d}d ${h%24}h`:h?`${h}h ${m%60}m`:`${m}m`;}
