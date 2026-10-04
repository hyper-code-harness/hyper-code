// The dashboard body, rendered server-side as one HTMX-swappable fragment so
// the window selector and the refresh button reuse the same code path.
//
// Layout rules this page follows, because a wall of tables is unreadable:
// every block is a card with its own heading, numbers are right-aligned and
// monospaced so columns line up, and latency is shown as a bar next to the
// figure — the length is what the eye reads, the number is the detail.
/**
 * Render the telemetry dashboard body as trusted HTML.
 *
 * Shows span totals for the window, traffic and latency charts, per-kind
 * latency, the HTTP routes and SQL statements that cost the most wall time,
 * the slowest statements Postgres itself recorded, recent slow or failed
 * spans, and what span storage occupies on disk.
 *
 * @param opts.hours Window size in hours. @default 24 @minimum 1 @maximum 8760
 * @param opts.limit Rows per ranked table. @default 10 @minimum 1 @maximum 100
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Window size in hours. @default 24 @minimum 1 @maximum 8760 */
    hours?: number;
    /** Rows per ranked table. @default 10 @minimum 1 @maximum 100 */
    limit?: number;
}): Promise<string> {
    const ui = ctx.fns.procs.ui;
    const esc = (value: unknown) => ui.escape({ text: value });
    const hours = Math.max(1, Math.min(Number(opts?.hours ?? 24), 8760));
    const limit = Math.max(1, Math.min(Number(opts?.limit ?? 10), 100));

    const [stats, storage, pg] = await Promise.all([
        ctx.fns.telemetry.stats({ hours, limit }),
        ctx.fns.telemetry.storage({}),
        ctx.fns.telemetry.pgStats({ limit }),
    ]);

    if (!stats.ok) {
        return `<div id="telemetry-body">${ui.alert({
            tone: "danger",
            title: "Cannot read span storage",
            text: `${stats.error ?? "unknown error"} — install DuckDB or set DUCKDB_BIN.`,
        })}</div>`;
    }

    const bytes = (n: number) => ctx.fns.telemetry.humanBytes({ bytes: n });
    const num = (n: number) => n.toLocaleString("en-US");
    const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value >= 100 ? Math.round(value) : value.toFixed(1)} ms`);
    const errorRate = stats.totals.spans ? (stats.totals.errors / stats.totals.spans) * 100 : 0;
    const slowest = stats.kinds.reduce<typeof stats.kinds[number] | undefined>((worst, kind) => (kind.p95 > (worst?.p95 ?? -1) ? kind : worst), undefined);

    // A number plus what it means, in a box with room around it.
    const tile = (opts2: { label: string; value: string; sub: string; tone?: "info" | "success" | "warning" | "danger"; icon: string }) => {
        const fg = opts2.tone ? `text-state-${opts2.tone === "danger" ? "danger" : opts2.tone}-fg` : "text-base-content";
        return `<div class="rounded-xl border border-ui-border bg-base-100 px-4 py-3">
  <div class="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-faint">
    <i class="ph ${esc(opts2.icon)} text-sm" aria-hidden="true"></i>${esc(opts2.label)}
  </div>
  <div class="mt-1.5 truncate text-xl font-semibold tabular-nums tracking-tight ${fg}">${esc(opts2.value)}</div>
  <div class="mt-0.5 text-2xs leading-4 text-subtle">${esc(opts2.sub)}</div>
</div>`;
    };

    const summary = `<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
${tile({ label: `Spans · ${hours}h`, value: num(stats.totals.spans), sub: stats.totals.from ? `${stats.totals.from} → ${stats.totals.to}` : "nothing recorded in this window", icon: "ph-pulse" })}
${tile({ label: "Errors", value: num(stats.totals.errors), sub: `${errorRate.toFixed(2)}% of all spans`, tone: stats.totals.errors ? "danger" : "success", icon: "ph-warning-octagon" })}
${tile({ label: "Slowest kind", value: slowest ? slowest.name : "—", sub: slowest ? `p95 ${ms(slowest.p95)} · ${num(slowest.count)} spans` : "nothing recorded", tone: slowest && slowest.p95 > 1000 ? "warning" : "info", icon: "ph-hourglass" })}
${tile({ label: "Storage", value: bytes(storage.totalBytes), sub: `${storage.cold.files} parquet · ${storage.pages.count} page(s) waiting`, icon: "ph-hard-drives" })}
</div>`;

    // Cards: one concern each, a quiet header, and real padding inside.
    const card = (opts2: { title: string; hint?: string; right?: string; body: string; pad?: boolean }) => `
<section class="overflow-hidden rounded-xl border border-ui-border bg-base-100">
  <header class="flex items-center justify-between gap-3 border-b border-ui-border px-4 py-3">
    <div class="min-w-0">
      <h2 class="truncate text-sm font-semibold tracking-tight">${esc(opts2.title)}</h2>
      ${opts2.hint ? `<p class="mt-0.5 text-2xs text-faint">${esc(opts2.hint)}</p>` : ""}
    </div>
    ${opts2.right ?? ""}
  </header>
  <div class="${opts2.pad === false ? "" : "p-4"}">${opts2.body}</div>
</section>`;

    // Latency as length. The bar is relative to the worst row on screen, which
    // is what makes "this one is the problem" visible without reading numbers.
    // Kept thin and translucent: it is a hint under the row, not a second
    // headline competing with the figure it belongs to.
    const bar = (value: number, worst: number, tone: "info" | "warning" | "danger") => {
        const percent = worst > 0 ? Math.max(2, Math.min(100, (value / worst) * 100)) : 0;
        return `<div class="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-base-200"><div class="h-full rounded-full opacity-70" style="width:${percent.toFixed(1)}%;background:var(--color-state-${tone}-fg)"></div></div>`;
    };
    const metric = (value: string, sub?: string) => `<div class="text-right"><div class="text-sm tabular-nums">${esc(value)}</div>${sub ? `<div class="text-micro text-faint">${esc(sub)}</div>` : ""}</div>`;

    // Ranked rows are a definition list, not a table: a long route or a long SQL
    // statement gets a line of its own instead of squeezing every other column.
    const ranked = (rows: string[], empty: string) => rows.length
        ? `<ul class="divide-y divide-ui-border">${rows.join("")}</ul>`
        : `<div class="px-4 py-8 text-center text-2xs text-faint">${esc(empty)}</div>`;

    const worstRoute = Math.max(1, ...stats.routes.map(route => route.p95));
    const routeRows = stats.routes.map(route => {
        const tone = route.p95 >= 500 ? "danger" : route.p95 >= 100 ? "warning" : "info";
        return `<li class="px-4 py-3">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <code class="block truncate text-xs text-base-content">${esc(route.route)}</code>
      <div class="mt-0.5 text-micro text-faint">${esc(num(route.count))} requests · p50 ${esc(ms(route.p50))} · max ${esc(ms(route.max))}</div>
    </div>
    ${metric(ms(route.p95), "p95")}
    ${metric(`${num(Math.round(route.totalSec))} s`, "total")}
  </div>
  ${bar(route.p95, worstRoute, tone)}
</li>`;
    });

    const worstQuery = Math.max(1, ...stats.queries.map(query => query.totalSec));
    const queryRows = stats.queries.map(query => {
        const tone = query.totalSec >= 600 ? "danger" : query.totalSec >= 60 ? "warning" : "info";
        return `<li class="px-4 py-3">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <code class="block truncate text-xs text-muted">${esc(String(query.query).slice(0, 160))}</code>
      <div class="mt-0.5 text-micro text-faint">${esc(num(query.count))} calls · p95 ${esc(ms(query.p95))}</div>
    </div>
    ${metric(`${num(Math.round(query.totalSec))} s`, "wall time")}
  </div>
  ${bar(query.totalSec, worstQuery, tone)}
</li>`;
    });

    const worstKind = Math.max(1, ...stats.kinds.map(kind => kind.p95));
    const kindRows = stats.kinds.map(kind => `<li class="px-4 py-3">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-xs font-medium">${esc(kind.name)}</span>
        ${kind.errors ? ui.badge({ text: `${num(kind.errors)} err`, tone: "danger" }) : ""}
      </div>
      <div class="mt-0.5 text-micro text-faint">${esc(num(kind.count))} spans · p50 ${esc(ms(kind.p50))} · max ${esc(ms(kind.max))}</div>
    </div>
    ${metric(ms(kind.p95), "p95")}
    ${metric(`${num(Math.round(kind.totalSec))} s`, "total")}
  </div>
  ${bar(kind.p95, worstKind, kind.p95 >= 1000 ? "danger" : kind.p95 >= 100 ? "warning" : "info")}
</li>`);

    const slowRows = stats.slow.map(span => `<li class="flex items-start gap-3 px-4 py-2.5">
  <i class="ph ${span.status === "error" ? "ph-x-circle text-state-danger-fg" : "ph-hourglass-high text-faint"} mt-0.5 text-sm" aria-hidden="true"></i>
  <div class="min-w-0 flex-1">
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">${esc(span.name)}</span>
      <span class="text-micro tabular-nums text-faint">${esc(span.ts)}</span>
    </div>
    ${span.detail ? `<div class="mt-0.5 truncate text-micro text-faint">${esc(String(span.detail).slice(0, 140))}</div>` : ""}
  </div>
  <span class="shrink-0 text-xs tabular-nums ${span.status === "error" ? "text-state-danger-fg" : "text-muted"}">${esc(ms(span.ms))}</span>
</li>`);

    // The server's own accounting. Span timings say what the application
    // waited for; pg_stat_statements says what the server did — and the gap
    // between them is where pool waits and cache misses hide.
    const worstPg = Math.max(1, ...pg.rows.map(row => row.totalSec));
    const pgRows = pg.rows.map(row => {
        const cache = row.hitPercent;
        const cold = cache != null && cache < 90;
        return `<li class="px-4 py-3">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <code class="block truncate text-xs text-muted">${esc(row.query.slice(0, 160))}</code>
      <div class="mt-0.5 text-micro text-faint">${esc(num(row.calls))} calls · mean ${esc(ms(row.meanMs))} · max ${esc(ms(row.maxMs))} · ${esc(num(Math.round(row.rowsPerCall)))} rows/call${cache == null ? "" : ` · <span class="${cold ? "text-state-warning-fg" : ""}">cache ${cache}%</span>`}</div>
    </div>
    ${metric(`${num(Math.round(row.totalSec))} s`, "server time")}
  </div>
  ${bar(row.totalSec, worstPg, row.totalSec >= 60 ? "danger" : row.totalSec >= 10 ? "warning" : "info")}
</li>`;
    });
    const pgBody = pg.available
        ? ranked(pgRows, "no statements recorded since the last reset")
        : `<div class="px-4 py-6 text-center text-2xs text-faint">${esc(pg.reason ?? "unavailable")}</div>`;

    const [volume, latency] = await Promise.all([
        ctx.fns.telemetry.chart({ points: stats.traffic, kind: "count", height: 140 }),
        ctx.fns.telemetry.chart({ points: stats.traffic, kind: "latency", height: 140 }),
    ]);

    const peak = stats.traffic.length ? Math.max(...stats.traffic.map(point => point.count)) : 0;
    const tiers = [stats.tiers.hot ? "hot NDJSON" : null, stats.tiers.cold ? "cold parquet" : null].filter(Boolean).join(" + ") || "no span files yet";
    const storageRows: Array<[string, string]> = [
        ["Open page", storage.openPage ? `${storage.openPage.file} · ${bytes(storage.openPage.bytes)}` : "—"],
        ["Closed pages", `${storage.pages.count} · ${bytes(storage.pages.bytes)}`],
        ["Parquet", `${storage.cold.files} files · ${storage.cold.partitions} day(s) · ${bytes(storage.cold.bytes)}`],
        ...(storage.cold.oldest ? [["Range", `${storage.cold.oldest} → ${storage.cold.newest}`] as [string, string]] : []),
        ...(storage.legacyBytes ? [["Unrotated legacy file", `${bytes(storage.legacyBytes)} — adopted on the next pass`] as [string, string]] : []),
        ["Reading from", tiers],
    ];
    const storagePanel = `<dl class="grid gap-x-8 gap-y-3 sm:grid-cols-2">${storageRows.map(([term, detail]) => `
  <div class="min-w-0">
    <dt class="text-2xs uppercase tracking-wide text-faint">${esc(term)}</dt>
    <dd class="mt-0.5 truncate text-xs text-base-content">${esc(detail)}</dd>
  </div>`).join("")}</dl>`;

    return `<div id="telemetry-body" class="space-y-4">
${summary}
<div class="grid items-start gap-4 lg:grid-cols-2">
${card({ title: "Span volume", hint: `${num(stats.totals.traces)} traces · peak ${num(peak)} per bucket`, body: volume })}
${card({ title: "Latency p95", hint: "per bucket, across every span kind", body: latency })}
</div>
<div class="grid items-start gap-4 lg:grid-cols-2">
${card({ title: "Span kinds", hint: "what the process spends its time on", body: ranked(kindRows, "no spans in this window"), pad: false })}
${card({ title: "Recent slow and failed", hint: "newest first", body: ranked(slowRows, "nothing slow or failed — good"), pad: false })}
</div>
${card({ title: "Slowest routes", hint: "ranked by total wall time spent answering", body: ranked(routeRows, "no spans carry an http.route attribute yet"), pad: false })}
${card({ title: "Heaviest queries", hint: "client-side span timings · normalized statements, no parameter values", body: ranked(queryRows, "no database spans in this window"), pad: false })}
${card({ title: "Postgres statements", hint: pg.available ? `pg_stat_statements · server-side, since ${pg.since ?? "the last reset"}` : "pg_stat_statements", body: pgBody, pad: false })}
${card({ title: "Storage", hint: "NDJSON pages compacted to day-partitioned parquet", body: storagePanel })}
</div>`;
}
