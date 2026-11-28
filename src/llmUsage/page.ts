/**
 * Show an owner-only Canvas page of LLM accounting totals, filters, ranked groups and a UTC trend.
 *
 * Open this addressable read-only view to inspect direct provider expenditure without prompts, responses or credentials. Filters use UTC call-start bounds; unknown usage is shown distinctly from zero. The owner check is enforced by the report on every render, including disabled and unmigrated states. No provider requests, writes or migrations are performed.
 * @view
 * @param opts.from Inclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to 24 hours before to.
 * @param opts.to Exclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to now. Maximum period 366 days.
 * @param opts.source Restrict calls to local use or authenticated node clients.
 * @param opts.agentId Exact local agent id; null selects calls without an agent. Omit or empty string for all.
 * @param opts.clientId Exact authenticated client id; null selects missing client. Omit or empty string for all.
 * @param opts.provider Exact terminal provider; null selects unknown. Omit or empty string for all.
 * @param opts.account Exact terminal account label; null selects unknown. Omit or empty string for all.
 * @param opts.model Exact terminal model; null selects unknown. Omit or empty string for all.
 * @param opts.groupBy Ranked dimension. Accounts are qualified by provider. @default provider
 * @param opts.limit Maximum ranked groups; totals and trend are never truncated. @default 50 @minimum 1 @maximum 100
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Inclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to 24 hours before to. */
        from?: number | string;
        /** Exclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to now. Maximum period 366 days. */
        to?: number | string;
        /** Restrict calls to local use or authenticated node clients. */
        source?: "local" | "node";
        /** Exact authenticated client id; null selects missing client. Omit or empty string for all. */
        clientId?: string | null;
        /** Exact local agent id; null selects calls without an agent. Omit or empty string for all. */
        agentId?: string | null;
        /** Exact terminal provider; null selects unknown. Omit or empty string for all. */
        provider?: string | null;
        /** Exact terminal account label; null selects unknown. Omit or empty string for all. */
        account?: string | null;
        /** Exact terminal model; null selects unknown. Omit or empty string for all. */
        model?: string | null;
        /** Ranked dimension. Accounts are qualified by provider. @default provider */
        groupBy?: "provider" | "model" | "account" | "client" | "agent";
        /** Maximum ranked groups; totals and trend are never truncated. @default 50 @minimum 1 @maximum 100 */
        limit?: number;
    },
): Promise<string> {
    const r = await ctx.fns.llmUsage.report({ ...opts, source: opts.source || undefined });
    const w = ctx.fns.w;
    const esc = (v: unknown) => w.escape({ text: String(v ?? "") });
    const num = (v: number | null) => v === null ? "—" : v.toLocaleString("en-US");
    const url = (extra: Record<string, unknown>) => ctx.fns.rpc.url({ fn: "llmUsage.page", params: { ...r.filters, ...extra } });
    const link = (label: string, extra: Record<string, unknown>) => `<a class="w-link" href="${esc(url(extra))}">${esc(label)}</a>`;
    const now = Date.now();
    const presets = [ ["24 часа", 1], ["7 дней", 7], ["30 дней", 30] ] as const;
    const nav = presets.map(([label, days]) => link(label, { from: now - days * 86_400_000, to: now })).join(" · ") + " · " + link("Обновить", {}) + " · " + link("Ссылка на фильтры", {});
    const heading = w.heading({ title: "Учёт LLM", meta: nav });
    if (!r.available) return `<section data-llm-usage>${w.box({ body: heading + w.empty({ title: r.reason === "disabled" ? "Учёт выключен" : "Хранилище учёта не подготовлено", hint: "Включение и создание таблиц выполняет владелец отдельно: llmUsage.setup({confirmed:true}), затем llmUsage.enabled=true. Эта страница ничего не записывает и не запускает миграции." }), mix: { layout: "stack", gap: "s4" } })}</section>`;
    const field = (key: string, label: string, value: unknown) => `<label>${esc(label)} <input name="${esc(key)}" value="${esc(value)}" maxlength="160" class="border rounded px-2 py-1" /></label>`;
    const option = (value: string, label: string, current?: string) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
    const form = `<form method="get" action="/rpc/llmUsage.page" hx-get="/rpc/llmUsage.page" hx-target="closest [data-llm-usage]" hx-select="[data-llm-usage]" hx-swap="outerHTML" class="flex flex-wrap gap-2 items-end">${field("from", "От (UTC)", new Date(r.filters.from).toISOString())}${field("to", "До (UTC, не включая)", new Date(r.filters.to).toISOString())}<label>Источник <select name="source">${option("", "Все", r.filters.source)}${option("local", "Локальный", r.filters.source)}${option("node", "Клиенты", r.filters.source)}</select></label>${field("clientId", "Клиент/инстанс ID", r.filters.clientId)}${field("agentId", "Агент ID", r.filters.agentId)}${field("provider", "Провайдер", r.filters.provider)}${field("account", "Аккаунт", r.filters.account)}${field("model", "Модель", r.filters.model)}<label>Группировка <select name="groupBy">${option("provider", "Провайдер", r.filters.groupBy)}${option("model", "Модель", r.filters.groupBy)}${option("account", "Аккаунт", r.filters.groupBy)}${option("client", "Клиент", r.filters.groupBy)}${option("agent", "Агент", r.filters.groupBy)}</select></label><button type="submit" class="border rounded px-2 py-1">Применить</button></form>`;
    const t = r.totals;
    const stats = w.stats({ items: [ { label: "Логические вызовы", value: num(t.calls), sub: `${t.success} успешных · ${t.errors} ошибок · ${t.cancelled} отменено · ${t.pending} выполняется` }, { label: "Попытки", value: num(t.attempts), sub: `${t.extraAttempts} дополнительных в выбранных фильтрах` }, { label: "Удалённые пересылки", value: num(t.remoteCalls), sub: "Справочно; без фильтров провайдер/аккаунт/модель" }, { label: "Вход без кэша", value: num(t.inputTokens) }, { label: "Выход", value: num(t.outputTokens) }, { label: "Чтение кэша", value: num(t.cacheReadTokens) }, { label: "Запись кэша", value: num(t.cacheWriteTokens) } ] });
    const note = w.box({ body: `Только прямые попытки провайдера; токены пересылок через Hyper исключены. Если удалённый вызов переключился на прямой, он присутствует в обоих счётчиках. Период — по началу логического вызова, UTC. Токены — сумма завершённых попыток, не денежный счёт. Данные: ${t.known} полных, ${t.partial} частичных, ${t.unknown} неизвестных попыток; «—» означает нет данных, а не ноль. В группах один вызов может встречаться несколько раз из-за повторов.`, mix: { text: "small", ink: "faint" } });
    const width = 720, height = 100, max = Math.max(1, ...r.trend.map(p => p.calls));
    const step = width / Math.max(1, r.trend.length);
    const bars = r.trend.map((p, i) => `<rect x="${(i * step).toFixed(2)}" y="${(height - p.calls / max * height).toFixed(2)}" width="${Math.max(0.5, step - 1).toFixed(2)}" height="${(p.calls / max * height).toFixed(2)}" fill="currentColor"><title>${esc(new Date(p.at).toISOString())}: ${p.calls}</title></rect>`).join("");
    const trend = w.heading({ title: "Вызовы по времени (UTC)" }) + `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Число логических вызовов по времени" class="w-full" height="100">${bars}</svg>` + w.table({ columns: [ { key: "time", label: "Начало интервала UTC" }, { key: "calls", label: "Вызовы" }, { key: "attempts", label: "Попытки" }, { key: "input", label: "Вход" }, { key: "output", label: "Выход" }, { key: "read", label: "Кэш чтение" }, { key: "write", label: "Кэш запись" } ], rows: r.trend.map(p => ({ time: new Date(p.at).toISOString().replace(".000Z", "Z"), calls: p.calls, attempts: p.attempts, input: num(p.inputTokens), output: num(p.outputTokens), read: num(p.cacheReadTokens), write: num(p.cacheWriteTokens) })) });
    const groups = w.heading({ title: "Группы", meta: [link("Провайдеры", { groupBy: "provider" }), link("Модели", { groupBy: "model" }), link("Аккаунты", { groupBy: "account" }), link("Клиенты", { groupBy: "client" }), link("Агенты", { groupBy: "agent" })].join(" · ") }) + w.table({ columns: [ { key: "name", label: "Имя" }, { key: "calls", label: "Вызовы" }, { key: "attempts", label: "Попытки" }, { key: "input", label: "Вход" }, { key: "output", label: "Выход" }, { key: "read", label: "Кэш чтение" }, { key: "write", label: "Кэш запись" } ], rows: r.groups.map(g => ({ name: g.label, calls: g.calls, attempts: g.attempts, input: num(g.inputTokens), output: num(g.outputTokens), read: num(g.cacheReadTokens), write: num(g.cacheWriteTokens) })) });
    return `<section data-llm-usage>${w.box({ body: heading + form + stats + note + groups + trend, mix: { layout: "stack", gap: "s4" } })}</section>`;
}
