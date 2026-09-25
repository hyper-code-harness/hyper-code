// The card a parked agent shows in its inspector.
//
// Parking is a wait with three ways out, and all three belong in one place:
// wait for the quota (already scheduled), switch to another model, or switch to
// another credential of the same provider. Without this card the only visible
// trace of an exhausted subscription is a yellow badge, and the user has to
// guess what to do about it.
/** Renders the inspector card for an agent parked by an exhausted subscription. */
/**
 * Render the parked-agent card with its quota reset time and recovery actions.
 *
 * Returns an empty string when the agent is not parked, so callers can inline
 * it unconditionally.
 *
 * @param opts.agent Agent whose scratchpad may carry a parking mark.
 * @param opts.models Available models grouped by provider, from llm.listModels.
 * @param opts.accounts Credential accounts with their quota, from llm.listAccounts.
 * @param opts.now Current time in ms, for testing.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent to render the card for. */
        agent: types.agent.Agent;
        /** Models grouped by provider, as returned by llm.listModels. */
        models?: Record<string, string[]>;
        /** Credential accounts, as returned by llm.listAccounts. */
        accounts?: Array<{ provider: string; account: string; label: string; model: string; available: boolean; usedPercent: number | null; resetsAt: number | null; parkedAgents: number }>;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const agent = opts.agent;
    const parked: any = (agent as any).scratchpad?.parked ?? null;
    if (!parked) return "";

    const now = opts.now ?? Date.now();
    const id = encodeURIComponent(agent.id);
    const account = parked.account && parked.account !== "default" ? `/${parked.account}` : "";
    const resetsAt = Number(parked.resetsAt ?? parked.wakeAt ?? 0);
    const left = resetsAt ? humanDelay(resetsAt - now) : null;
    const when = resetsAt ? new Date(resetsAt).toLocaleString() : "время неизвестно";

    // Same-family alternatives first: the fastest fix is usually the same class
    // of model billed differently, not a different model.
    const current = String((agent as any).model ?? parked.model ?? "");
    const suggestions = alternatives(current, parked.provider, opts.models ?? {});
    const groups = Object.entries(opts.models ?? {})
        .map(([provider, list]) => {
            const options = (list ?? [])
                .map((m) => `<option value="${esc(m)}"${m === current ? " disabled" : ""}>${esc(m)}</option>`)
                .join("");
            return options ? `<optgroup label="${esc(provider)}">${options}</optgroup>` : "";
        })
        .join("");

    // Accounts first, models second. When one login is spent the fastest fix is
    // almost always the OTHER login of the same vendor, and it can only be
    // chosen honestly if its remaining quota is on screen next to it.
    const accounts = (opts.accounts ?? [])
        .filter((a) => !(a.provider === parked.provider && a.account === (parked.account ?? "default")))
        // A sibling login of the same vendor first: same models, same behaviour,
        // just another quota. Then other providers, freest first.
        .sort((a, b) => Number(b.provider === parked.provider) - Number(a.provider === parked.provider)
            || (a.usedPercent ?? 0) - (b.usedPercent ?? 0));
    const spent = (opts.accounts ?? []).find((a) => a.provider === parked.provider && a.account === (parked.account ?? "default"));
    const accountRows = accounts.map((a) => {
        const known = a.usedPercent != null;
        const tone = !a.available ? "text-error" : known && a.usedPercent! >= 75 ? "text-error" : known && a.usedPercent! >= 50 ? "text-warning" : "text-success";
        const state = !a.available
            ? `исчерпан${a.resetsAt ? ` · сброс через ${humanDelay(a.resetsAt - now)}` : ""}`
            : known ? `свободно ${Math.round(100 - a.usedPercent!)}%` : "нет данных";
        // A sibling login of the SAME provider keeps the model and swaps only
        // the credential; another provider brings its own model along.
        const target = a.provider === parked.provider ? swapAccount(current, a.account) : (a.model.endsWith(":") ? "" : a.model);
        const button = target && a.available
            ? `<form hx-post="/agent/${id}/model" hx-swap="none" class="contents"><input type="hidden" name="model" value="${esc(target)}"><input type="hidden" name="scope" value="provider">${ctx.fns.procs.ui.button({ action: 'use-model-account', label: 'Use', type: 'submit', size: 'xs' })}</form>`
            : `<span class="text-3xs text-faint">${a.available ? "нет модели" : "ждёт"}</span>`;
        return `<div class="flex items-center gap-1.5 py-0.5">
            ${ctx.fns.ui.modelLogo?.({ model: a.model || `${a.provider}:`, bare: true, compact: true }) ?? ""}
            <span class="min-w-0 flex-1 truncate" title="${esc(a.model)}">${esc(a.provider === parked.provider ? `${a.account} — тот же провайдер` : a.label)}</span>
            <span class="font-mono text-3xs ${tone}">${esc(state)}</span>
            ${button}
          </div>`;
    }).join("");

    const accountBlock = accountRows
        ? `<div class="mt-2 rounded border border-base-300 bg-base-100/60 px-1.5 py-1">
             <div class="mb-0.5 text-3xs font-medium uppercase tracking-wide text-faint">Switch account</div>
             ${spent ? `<div class="flex items-center gap-1.5 py-0.5 opacity-45"><span class="min-w-0 flex-1 truncate">${esc(spent.label)} (текущий)</span><span class="font-mono text-3xs text-error">исчерпан</span></div>` : ""}
             ${accountRows}
           </div>`
        : "";

    const quickButtons = suggestions.length
        ? `<div class="mt-2 flex flex-wrap gap-1">${suggestions
            .map((m) => `<form hx-post="/agent/${id}/model" hx-swap="none" class="contents"><input type="hidden" name="model" value="${esc(m)}"><input type="hidden" name="scope" value="provider">${ctx.fns.procs.ui.button({ action: 'switch-suggested-model', label: m, type: 'submit', size: 'xs', class: 'font-mono text-3xs', title: `перевести всех агентов с ${parked.provider}${account} на ${m} — тот же класс модели, оплата по токенам` })}</form>`)
            .join("")}</div>`
        : "";

    const picker = groups
        ? `<form hx-post="/agent/${id}/model" hx-swap="none" class="mt-2 space-y-1">
             <select name="model" aria-label="Switch model" class="select select-bordered select-sm w-full font-mono text-2xs">${groups}</select>
             <label class="flex items-center gap-1 text-3xs text-subtle"><input type="checkbox" name="scope" value="provider" class="checkbox checkbox-xs" checked>применить ко всем на ${esc(parked.provider)}${esc(account)}</label>
             ${ctx.fns.procs.ui.button({ action: 'switch-model', label: 'Switch', type: 'submit', tone: 'primary', size: 'xs', class: 'w-full' })}
           </form>`
        : "";

    const controls = `<div class="mt-2 flex gap-1">
        <form hx-post="/agent/${id}/unpark" hx-swap="none" class="contents"><input type="hidden" name="action" value="now">${ctx.fns.procs.ui.button({ action: 'wake-parked-agent', label: 'Wake now', type: 'submit', tone: 'ghost', size: 'xs', title: 'если квота ещё не вернулась, агент припаркуется снова' })}</form>
        <form hx-post="/agent/${id}/unpark" hx-swap="none" class="contents"><input type="hidden" name="action" value="cancel">${ctx.fns.procs.ui.button({ action: 'cancel-parking', label: 'Cancel parking', type: 'submit', tone: 'ghost', size: 'xs', class: 'text-error' })}</form>
      </div>`;

    return `<div class="rounded-md border border-warning/40 bg-warning/10 px-2 py-2 text-2xs leading-5">
      <div class="flex items-center gap-1 font-medium text-warning"><i class="ph ph-pause-circle" aria-hidden="true"></i><span>Parked · usage limit</span></div>
      <div class="mt-1 font-mono text-3xs text-muted">${esc(parked.provider)}${esc(account)}${parked.planType ? ` · ${esc(parked.planType)}` : ""}</div>
      <div class="text-subtle">Квота вернётся ${esc(when)}${left ? ` (через ${esc(left)})` : ""}</div>
      ${accountBlock}${quickButtons}${picker}${controls}
    </div>`;
}

// The same model family through a different billing path is the switch a user
// almost always wants: subscription exhausted → same vendor by API key, or the
// provider's second credential.
const SIBLINGS: Record<string, string[]> = {
    codex: ["openai"],
    "claude-code": ["anthropic", "anthropic-oauth"],
    xai: [],

    "anthropic-oauth": ["anthropic", "claude-code"],
    "kimi-coding": ["kimi"],
};

function alternatives(current: string, provider: string, models: Record<string, string[]>): string[] {
    const out: string[] = [];
    for (const sibling of SIBLINGS[provider] ?? []) {
        const first = (models[sibling] ?? [])[0];
        if (first && first !== current) out.push(first);
    }
    return out.slice(0, 3);
}

// "codex:gpt-5.6-sol" + "personal" → "codex/personal:gpt-5.6-sol". Same model,
// different credential — the cheapest possible switch.
function swapAccount(model: string, account: string): string {
    const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:(.+)$/.exec(model);
    if (!m) return model;
    return account === "default" ? `${m[1]}:${m[3]}` : `${m[1]}/${account}:${m[3]}`;
}

function humanDelay(ms: number): string {
    const left = Math.max(0, ms);
    const minutes = Math.floor(left / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}д ${hours % 24}ч`;
    if (hours >= 1) return `${hours}ч ${minutes % 60}м`;
    return `${minutes}м`;
}
