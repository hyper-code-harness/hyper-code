/**
 * Renders the provider, credential account and model picker for one agent.
 *
 * Builds explicit Provider → Account → Model navigation from llm.listModels and
 * llm.listAccounts. Submitting a model always uses scope=agent, so the action
 * moves only the selected agent; bulk migration remains a separate parked-card
 * action.
 *
 * @param opts.agentId Agent whose route should be inspected or changed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Identifier of the live or persisted agent whose route can be changed. */
        agentId: string;
    },
): Promise<Response> {
    const id = String(opts.agentId ?? "").trim();
    if (!id) return new Response("agentId is required", { status: 400 });
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("agent not found", { status: 404 });

    const esc = (value: unknown) => ctx.fns.procs.ui.escape({ text: String(value ?? "") });
    const current = String(agent.model ?? "");
    const currentRoute = parseRoute(current);
    const [listed, accountRows] = await Promise.all([
        ctx.fns.llm.listModels({}),
        ctx.fns.llm.listAccounts({}).catch(() => [] as any[]),
    ]);

    const groups: Record<string, string[]> = {};
    for (const [provider, models] of Object.entries(listed ?? {})) {
        const values = Array.from(new Set((models ?? []).map(String).filter(Boolean)));
        if (values.length) groups[provider] = values;
    }
    if (current && !Object.values(groups).some(models => models.some(model => sameBaseModel(model, current)))) {
        (groups[currentRoute.provider] ??= []).unshift(stripAccount(current));
    }

    const labels: Record<string, string> = {
        "claude-code": "Claude Code",
        "anthropic-oauth": "Claude managed",
        anthropic: "Anthropic API",
        codex: "Codex",
        openai: "OpenAI API",
        openrouter: "OpenRouter",
        "kimi-coding": "Kimi Coding",
        kimi: "Kimi API",
        groq: "Groq",
        lmstudio: "LM Studio",
        mock: "Mock",
    };
    const entries = Object.entries(groups).map(([provider, models]) => ({
        provider,
        models,
        accounts: accountsFor(provider, accountRows, currentRoute),
    })).sort((a, b) => {
        if (a.provider === currentRoute.provider) return -1;
        if (b.provider === currentRoute.provider) return 1;
        return (labels[a.provider] ?? a.provider).localeCompare(labels[b.provider] ?? b.provider);
    });

    const providerNav = entries.map((entry, providerIndex) => {
        const selected = entry.provider === currentRoute.provider || (!entries.some(e => e.provider === currentRoute.provider) && providerIndex === 0);
        const html = `${ctx.fns.ui.modelLogo({ model: entry.models[0] ?? entry.provider + ":?", bare: true, compact: true })}<span class="truncate">${esc(labels[entry.provider] ?? entry.provider)}</span><span class="ml-auto text-3xs text-faint">${entry.models.length} models</span>`;
        return ctx.fns.procs.ui.button({ action: "select-model-provider", html, ariaLabel: `Show ${labels[entry.provider] ?? entry.provider} accounts`, class: `flex w-full items-center gap-2 rounded-lg text-left text-xs ${selected ? "bg-primary/10 font-medium text-primary" : "text-subtle"}`, attrs: { "data-model-provider-tab": true, "aria-selected": selected, onclick: providerScript(providerIndex) } });
    }).join("");

    const providerPanels = entries.map((entry, providerIndex) => {
        const providerSelected = entry.provider === currentRoute.provider || (!entries.some(e => e.provider === currentRoute.provider) && providerIndex === 0);
        const accountNav = entry.accounts.map((account, accountIndex) => {
            const selected = account.account === currentRoute.account && entry.provider === currentRoute.provider || (entry.provider !== currentRoute.provider && accountIndex === 0);
            const quota = account.usedPercent == null ? "usage —" : `${Math.round(100 - account.usedPercent)}% left`;
            const plan = account.planType ? planName(entry.provider, account.planType) : "";
            const html = `<span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium">${esc(account.account === "default" ? "main" : account.account)}</span><span class="block truncate text-micro text-faint">${esc([plan, quota].filter(Boolean).join(" · "))}</span></span>${account.needsReconnect ? '<span class="text-micro text-error">Reconnect required</span>' : !account.available ? '<span class="text-micro text-error">limit</span>' : ""}`;
            return ctx.fns.procs.ui.button({ action: "select-model-account", html, ariaLabel: `Use account ${account.account}`, disabled: !account.available && !selected, class: `flex w-full items-center gap-2 rounded-lg text-left ${selected ? "bg-primary/10 text-primary" : "text-muted"}`, attrs: { "data-model-account-tab": true, "aria-selected": selected, onclick: accountScript(accountIndex) } });
        }).join("");
        const modelPanels = entry.accounts.map((account, accountIndex) => {
            const accountSelected = account.account === currentRoute.account && entry.provider === currentRoute.provider || (entry.provider !== currentRoute.provider && accountIndex === 0);
            const rows = entry.models.map(baseModel => {
                const target = withAccount(baseModel, entry.provider, account.account);
                const selected = target === current;
                const modelId = parseRoute(target).modelId;
                const html = `<span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium">${esc(modelId)}</span><span class="block truncate font-mono text-micro text-faint">${esc(target)}</span></span>${selected ? '<i class="ph ph-check-circle text-primary" aria-hidden="true"></i>' : '<i class="ph ph-arrow-right text-faint" aria-hidden="true"></i>'}`;
                return `<form hx-post="/agent/${encodeURIComponent(id)}/model" hx-swap="none" class="contents"><input type="hidden" name="model" value="${esc(target)}"><input type="hidden" name="scope" value="agent">${ctx.fns.procs.ui.button({ action: "select-model", html, type: "submit", disabled: selected || account.needsReconnect, class: `flex w-full items-center gap-2 rounded-lg text-left ${selected ? "border-primary/30 bg-primary/10 text-primary" : "text-muted"}`, attrs: selected ? { "aria-current": "true" } : account.needsReconnect ? { title: "Reconnect this account in LLM connections before selecting it" } : {} })}</form>`;
            }).join("");
            return `<section data-model-account-panel class="${accountSelected ? "" : "hidden "}min-h-0"><div class="mb-2 flex items-center justify-between gap-2"><div><h3 class="text-xs font-semibold">${esc(account.account === "default" ? "main" : account.account)}</h3><p class="text-micro text-faint">${esc(`${entry.provider}${account.account === "default" ? "" : `/${account.account}`}:`)}</p></div>${account.planType ? `<span class="badge badge-sm">${esc(planName(entry.provider, account.planType))}</span>` : ""}</div><div class="grid gap-1.5">${rows}</div></section>`;
        }).join("");
        return `<section data-model-provider-panel class="${providerSelected ? "" : "hidden "}min-h-0"><div class="grid min-h-0 grid-cols-[8rem_minmax(0,1fr)] gap-3"><nav aria-label="Accounts" class="space-y-1 border-r border-ui-border pr-3">${accountNav}</nav><div>${modelPanels}</div></div></section>`;
    }).join("");

    const html = entries.length
        ? `<div data-model-picker class="grid min-h-0 grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]"><nav aria-label="Providers" class="max-h-[58vh] space-y-1 overflow-auto border-b border-ui-border pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">${providerNav}</nav><div class="max-h-[58vh] overflow-auto pr-1">${providerPanels}</div></div><p class="mt-3 border-t border-ui-border pt-2 text-3xs text-faint">This changes only agent <span class="font-mono">${esc(id)}</span>. Chat history stays unchanged; the next call uses the selected account and model.</p>`
        : '<div class="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-subtle">No configured model providers are available.</div>';
    return new Response(ctx.fns.ui.popupContent({ title: "Provider, account and model", kind: "model-picker", class: "w-full max-w-3xl", html }), { headers: { "content-type": "text/html; charset=utf-8" } });
}

type Account = { provider: string; account: string; available: boolean; needsReconnect: boolean; usedPercent: number | null; planType: string | null };
function accountsFor(provider: string, rows: any[], current: ReturnType<typeof parseRoute>): Account[] {
    const found = rows.filter(row => row.provider === provider).map(row => ({ provider, account: String(row.account ?? "default"), available: row.available !== false, needsReconnect: row.needsReconnect === true, usedPercent: row.usedPercent ?? null, planType: row.planType ?? null }));
    if (!found.length) found.push({ provider, account: "default", available: true, needsReconnect: false, usedPercent: null, planType: null });
    if (provider === current.provider && !found.some(row => row.account === current.account)) found.unshift({ provider, account: current.account, available: true, needsReconnect: false, usedPercent: null, planType: null });
    return found.sort((a, b) => Number(b.account === current.account && provider === current.provider) - Number(a.account === current.account && provider === current.provider));
}
function parseRoute(model:string){const m=/^([a-z][\w-]*)(?:\/([\w.-]+))?:(.+)$/.exec(model);return {provider:m?.[1]??"lmstudio",account:m?.[2]??"default",modelId:m?.[3]??model};}
function stripAccount(model:string){const p=parseRoute(model);return `${p.provider}:${p.modelId}`;}
function withAccount(model:string,provider:string,account:string){const p=parseRoute(model);return `${provider}${account==="default"?"":`/${account}`}:${p.modelId}`;}
function sameBaseModel(a:string,b:string){const x=parseRoute(a),y=parseRoute(b);return x.provider===y.provider&&x.modelId===y.modelId;}
function planName(provider:string,plan:string){const p=plan.toLowerCase();if(provider==="codex"&&p==="prolite")return "ChatGPT Go";return p.charAt(0).toUpperCase()+p.slice(1);}
function providerScript(index:number){return `const root=this.closest('[data-model-picker]');root.querySelectorAll('[data-model-provider-tab]').forEach((tab,i)=>{const on=i===${index};tab.setAttribute('aria-selected',String(on));tab.classList.toggle('bg-primary/10',on);tab.classList.toggle('font-medium',on);tab.classList.toggle('text-primary',on)});root.querySelectorAll(':scope > div > [data-model-provider-panel]').forEach((panel,i)=>panel.classList.toggle('hidden',i!==${index}))`;}
function accountScript(index:number){return `const panel=this.closest('[data-model-provider-panel]');panel.querySelectorAll('[data-model-account-tab]').forEach((tab,i)=>{const on=i===${index};tab.setAttribute('aria-selected',String(on));tab.classList.toggle('bg-primary/10',on);tab.classList.toggle('text-primary',on)});panel.querySelectorAll('[data-model-account-panel]').forEach((item,i)=>item.classList.toggle('hidden',i!==${index}))`;}
