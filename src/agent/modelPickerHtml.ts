/**
 * Renders the Subscription type → Model → Account picker body as embeddable HTML.
 *
 * Shared by the per-agent model popup (agent.modelPicker) and the new-agent
 * form (agent.newForm). Own providers come first, every Hyper node follows as
 * its own "via proxy" entry whose accounts are the host's providers.
 * In `agent` mode each model posts to /agent/<id>/model; in `form` mode a
 * click only writes the route into the enclosing form's hidden `model` input.
 *
 * @param opts.current Currently selected model route, e.g. "codex:gpt-6-sol".
 * @param opts.mode "agent" posts the choice for opts.agentId; "form" fills a hidden input.
 * @param opts.agentId Agent whose model is changed in agent mode.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Currently selected model route ("<provider>[/<account>]:<model>"); empty selects nothing. */
        current: string;
        /** "agent" posts the choice to /agent/<agentId>/model; "form" writes it into the form's hidden `model` input. @default "agent" */
        mode?: "agent" | "form";
        /** Agent whose route is changed; required in agent mode. */
        agentId?: string;
    },
): Promise<string> {
    const mode = opts.mode ?? "agent";
    const id = String(opts.agentId ?? "");
    const esc = (value: unknown) => ctx.fns.w.escape({ text: String(value ?? "") });
    let current = String(opts.current ?? "");
    const pool = await ctx.fns.llm.claudePoolSelect({ readOnly: true });
    // Access-token expiry is refreshable; only durable auth failure requires reconnect.
    const reconnect = new Set(pool.enabled ? (await ctx.fns.llm.accountAuthHealth({ action: "list" }))
        .filter(row => row.provider === "anthropic-oauth" && row.needsReconnect).map(row => row.account) : []);
    const isClaude = (provider: string) => provider === "claude-code" || provider === "anthropic-oauth";
    if (pool.enabled && isClaude(parseRoute(current).provider)) current = `claude-code:${parseRoute(current).modelId}`;
    const currentRoute = parseRoute(current);
    const [listed, accountRows] = await Promise.all([
        ctx.fns.llm.listModels({}),
        ctx.fns.llm.listAccounts({}).catch(() => [] as any[]),
    ]);

    const groups: Record<string, string[]> = {};
    for (const [group, models] of Object.entries(listed ?? {})) {
        // Hyper nodes are not one provider here: each node becomes its own proxy
        // entry below, with the host's providers as its accounts.
        if (group.startsWith("hyper/") || group === "hyper") continue;
        const rawProvider = group.split("/")[0]!;
        const provider = pool.enabled && isClaude(rawProvider) ? "claude-code" : rawProvider;
        const values = Array.from(new Set((models ?? []).map(model => pool.enabled && isClaude(rawProvider) ? `claude-code:${parseRoute(String(model)).modelId}` : stripAccount(String(model))).filter(Boolean)));
        if (values.length) groups[provider] = Array.from(new Set([...(groups[provider] ?? []), ...values]));
    }
    if (current && !Object.values(groups).some(models => models.some(model => sameBaseModel(model, current)))) {
        if (currentRoute.provider !== "hyper") (groups[currentRoute.provider] ??= []).unshift(stripAccount(current));
    }

    const labels: Record<string, string> = {
        "claude-code": pool.enabled ? "Claude" : "Claude Code",
        "anthropic-oauth": "Claude managed",
        anthropic: "Anthropic API",
        codex: "Codex",
        openai: "OpenAI API",
        openrouter: "OpenRouter",
        "kimi-coding": "Kimi Coding",
        kimi: "Kimi API",
        cursor: "Cursor",
        groq: "Groq",
        hyper: "Hyper nodes",
        lmstudio: "LM Studio",
        mock: "Mock",
    };
    const entries: Entry[] = Object.entries(groups).map(([provider, models]) => ({
        provider,
        models,
        accounts: pool.enabled && provider === "claude-code" ? pool.accounts.map(item => {
            const row = accountRows.find(row => row.provider === "anthropic-oauth" && row.account === item.account);
            return { provider, account: item.account, available: item.available && !reconnect.has(item.account), needsReconnect: reconnect.has(item.account), usedPercent: row?.usedPercent ?? null, planType: row?.planType ?? null };
        }) : accountsFor(provider, accountRows, currentRoute),
    })).sort((a, b) => {
        if (a.provider === currentRoute.provider) return -1;
        if (b.provider === currentRoute.provider) return 1;
        return (labels[a.provider] ?? a.provider).localeCompare(labels[b.provider] ?? b.provider);
    });
    entries.push(...await proxyEntries(ctx, listed ?? {}, accountRows, currentRoute, current));

    const w = ctx.fns.w;
    const navRow = (entry: Entry, providerIndex: number) => {
        const selected = isSelectedProvider(entries, entry, providerIndex, currentRoute);
        const name = entry.node ?? labels[entry.provider] ?? entry.provider;
        const count = new Set(entry.node ? entry.accounts.flatMap(account => account.models ?? []) : entry.models).size;
        return w.listRow({
            label: name,
            meta: entry.node ? "proxy" : undefined,
            icon: entry.node ? "arrows-left-right" : undefined,
            lead: entry.node ? undefined : ctx.fns.ui.modelLogo({ model: entry.models[0] ?? entry.provider + ":?", bare: true, compact: true }),
            hint: String(count),
            action: { action: "select-model-provider" },
            attrs: { "data-model-provider-tab": true, "aria-selected": String(selected), "aria-label": entry.node ? `Show models relayed by Hyper node ${entry.node}` : `Show ${name} models`, onclick: providerScript(providerIndex) },
        });
    };
    const own = entries.map((entry, i) => entry.node ? "" : navRow(entry, i)).join("");
    const proxied = entries.map((entry, i) => entry.node ? navRow(entry, i) : "").join("");
    const providerNav = own + (proxied ? w.listSection({ title: "via proxy", rows: proxied }) : "");

    const providerPanels = entries.map((entry, providerIndex) => {
        const providerSelected = isSelectedProvider(entries, entry, providerIndex, currentRoute);
        const pooled = pool.enabled && entry.provider === "claude-code" && !entry.node;
        const models = [...new Set(entry.node ? entry.accounts.flatMap(account => account.models ?? []) : entry.models)];
        const selectedIndex = Math.max(0, models.findIndex(model => sameBaseModel(model, current)));
        const modelNav = models.map((model, index) => w.listRow({
            label: parseRoute(model).modelId,
            current: model === stripAccount(current),
            action: { action: "select-picker-model" },
            attrs: { "data-picker-model-tab": true, "aria-selected": String(index === selectedIndex), onclick: modelScript(index) },
        })).join("");
        const accountPanels = models.map((model, index) => {
            const accounts = entry.node ? entry.accounts.filter(account => account.models?.includes(model)) : entry.accounts;
            const rows = accounts.map(account => {
                const target = entry.node ? model : pooled ? `claude-code:${parseRoute(model).modelId}` : withAccount(model, entry.provider, account.account);
                const selected = pooled ? account.account === pool.account : target === current;
                const disabled = !account.available || account.needsReconnect;
                const quota = account.usedPercent == null ? "usage —" : `${Math.round(100 - account.usedPercent)}% left`;
                const status = account.needsReconnect ? "Reconnect required in LLM connections" : !account.available ? "Quota exhausted" : selected ? "current" : undefined;
                return w.listRow({
                    label: entry.node ? "Use model on host" : account.account === "default" ? "main" : account.account,
                    detail: [account.planType ? planName(account.upstream ?? entry.provider, account.planType) : "", quota].filter(Boolean).join(" · "),
                    hint: status,
                    dot: disabled ? "error" : undefined,
                    current: selected,
                    action: disabled ? undefined : mode === "form" ? { action: "select-model" } : { post: `/agent/${encodeURIComponent(id)}/model`, vals: { model: target, scope: "agent", ...(pooled ? { claudeAccount: account.account } : {}) } },
                    attrs: {
                        "data-model-route": target,
                        "data-claude-account": pooled ? account.account : "",
                        "aria-disabled": disabled ? "true" : undefined,
                        onclick: !disabled && mode === "form" ? FORM_SELECT : undefined,
                    },
                });
            }).join("");
            const note = entry.node ? `Credentials managed on host ${entry.node}; this does not change the remote account.` : pooled ? `Current shared Claude account: ${pool.account ?? "none available"}. Automatically switches when quota is exhausted. Choosing an account changes the shared Claude account for ALL chats + relay${mode === "form" ? " when this form is submitted" : ""}.` : "Choose the account for this model.";
            return `<div data-picker-model-panel${index === selectedIndex ? "" : " hidden"}>${w.heading({ title: entry.node ? "3. Managed on host" : "3. Account" })}${w.box({ body: esc(note) })}${w.list({ body: rows, label: "Accounts" })}</div>`;
        }).join("");
        return `<div data-model-provider-panel${providerSelected ? "" : " hidden"}>${w.masterDetail({ master: w.heading({ title: "2. Model" }) + w.list({ body: modelNav, label: "Models" }), detail: accountPanels })}</div>`;
    }).join("");

    if (!entries.length) return w.empty({ title: "No configured model providers are available.", icon: "warning" });
    const picker = w.masterDetail({ master: w.heading({ title: "1. Subscription type" }) + w.list({ body: providerNav, label: "Subscription types" }), detail: providerPanels, attrs: { "data-model-picker": true } });
    if (mode === "form") return `<div data-model-picker-field><input type="hidden" name="model" value="${esc(current)}"><input type="hidden" name="claudeAccount" value="">`
        + w.box({ body: `Model: <span data-model-picker-current>${esc(current || "—")}</span>`, mix: { text: "small", ink: "muted", mono: true, padY: "s2" } })
        + picker + `</div>`;
    return picker;
}

type Account = { provider: string; account: string; available: boolean; needsReconnect: boolean; usedPercent: number | null; planType: string | null; label?: string; upstream?: string; models?: string[] };
type Entry = { provider: string; models: string[]; accounts: Account[]; node?: string };

const UPSTREAM_LABELS: Record<string, string> = { "claude-code": "Claude Code", "anthropic-oauth": "Claude managed", anthropic: "Anthropic API", codex: "Codex", openai: "OpenAI API", openrouter: "OpenRouter", "kimi-coding": "Kimi Coding", kimi: "Kimi API", cursor: "Cursor", groq: "Groq", xai: "xAI" };

// One entry per Hyper node (docs/hyper-node.md): the node is shown like a
// provider with a proxy mark, its "accounts" are the host's own providers
// (with the host-side plan and quota), and their models keep the routable
// hyper/<node>:<model> id. Chained models (via) sit under their upstream
// provider with the hop noted.
async function proxyEntries(ctx: Context, listed: Record<string, string[]>, accountRows: any[], current: ReturnType<typeof parseRoute>, currentModel: string): Promise<Entry[]> {
    let nodes: types.node.NodeEntry[] = [];
    try { nodes = await ctx.fns.node.list({}); } catch { nodes = []; }
    const out: Entry[] = [];
    const names = new Set([...nodes.filter(n => n.enabled).map(n => n.name), ...Object.keys(listed).filter(g => g.startsWith("hyper/")).map(g => g.slice(6))]);
    if (current.provider === "hyper") names.add(current.account);
    for (const name of names) {
        const node = nodes.find(n => n.name === name);
        const row = accountRows.find(r => r.provider === "hyper" && r.account === name);
        const listedIds = new Set((listed[`hyper/${name}`] ?? []).map(m => parseRoute(m).modelId));
        const catalog = (node?.catalog ?? []).filter(e => listedIds.has(e.id));
        const byUpstream = new Map<string, { provider: string; account: string; via?: string; ids: string[] }>();
        for (const e of catalog) {
            const key = `${e.provider}/${e.account}/${e.via ?? ""}`;
            const group = byUpstream.get(key) ?? { provider: e.provider, account: e.account, via: e.via, ids: [] };
            group.ids.push(e.id);
            byUpstream.set(key, group);
        }
        // Catalogue missing (node offline, never fetched): fall back to listed ids.
        if (!byUpstream.size && listedIds.size) byUpstream.set("?", { provider: "hyper", account: "default", ids: [...listedIds] });
        const route = (id: string) => `hyper/${name}:${id}`;
        if (current.provider === "hyper" && current.account === name && ![...byUpstream.values()].some(g => g.ids.includes(current.modelId))) {
            byUpstream.set("current", { provider: "hyper", account: "default", ids: [current.modelId] });
        }
        const accounts: Account[] = [...byUpstream.values()].map(g => {
            const usage = node?.usage?.find(u => u.provider === g.provider && u.account === g.account);
            const label = g.provider === "hyper" ? "models" : `${UPSTREAM_LABELS[g.provider] ?? g.provider}${g.account !== "default" ? ` · ${g.account}` : ""}${g.via ? ` (${g.via.replace(/^hyper\//, "via ")})` : ""}`;
            const offline = !row || row.available === false;
            return { provider: "hyper", account: name, label, upstream: g.provider, models: g.ids.map(route), available: !offline, needsReconnect: false, usedPercent: usage?.usedPercent ?? null, planType: usage?.planType ?? null };
        });
        if (!accounts.length) continue;
        // The current route's upstream first, so the right panel opens on it.
        accounts.sort((a, b) => Number(b.models!.includes(currentModel)) - Number(a.models!.includes(currentModel)));
        out.push({ provider: "hyper", node: name, models: accounts.flatMap(a => a.models!), accounts });
    }
    return out.sort((a, b) => a.node!.localeCompare(b.node!));
}
function isSelectedProvider(entries: Entry[], entry: Entry, index: number, current: ReturnType<typeof parseRoute>): boolean {
    const owns = (e: Entry) => e.node ? current.provider === "hyper" && current.account === e.node : e.provider === current.provider;
    return owns(entry) || (!entries.some(owns) && index === 0);
}
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
function providerScript(index:number){return `const root=this.closest('[data-model-picker]');root.querySelectorAll('[data-model-provider-tab]').forEach((tab,i)=>tab.setAttribute('aria-selected',String(i===${index})));root.querySelectorAll('[data-model-provider-panel]').forEach((panel,i)=>panel.hidden=i!==${index})`;}
const FORM_SELECT = `const field=this.closest('[data-model-picker-field]');const route=this.dataset.modelRoute;field.querySelector('input[name=model]').value=route;field.querySelector('input[name=claudeAccount]').value=this.dataset.claudeAccount||'';field.querySelector('[data-model-picker-current]').textContent=route;field.querySelectorAll('[data-model-route]').forEach(b=>b.toggleAttribute('aria-current',b===this))`;
function modelScript(index:number){return `const panel=this.closest('[data-model-provider-panel]');panel.querySelectorAll('[data-picker-model-tab]').forEach((tab,i)=>tab.setAttribute('aria-selected',String(i===${index})));panel.querySelectorAll('[data-picker-model-panel]').forEach((item,i)=>item.hidden=i!==${index})`;}
