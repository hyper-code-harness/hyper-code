import { expect, test, describe } from "bun:test";
import paths from "./paths";
import pageName from "./pageName";
import humanBytes from "./humanBytes";
import spanSource from "./spanSource";
import rotate from "./rotate";
import compact from "./compact";
import prune from "./prune";
import storage from "./storage";
import stats from "./stats";
import duck from "./duck";
import chart from "./chart";
import dashboard from "./dashboard";
import pgStats from "./pgStats";
import { mkdtemp, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG = {
    pageBytes: 1024, pageByDay: true, maintainMs: 300000,
    coldRetentionDays: 90, duckdbBin: "duckdb", duckdbTimeout: 60,
};

async function makeCtx() {
    const runtime = await mkdtemp(join(tmpdir(), "tel-"));
    const state: any = { procs: { telemetry: { file: `${runtime}/telemetry.ndjson`, enabled: true } } };
    const logged: any[] = [];
    const ctx: any = {
        state,
        env: {},
        fns: {
            procs: {
                project: { runtimeDir: () => runtime },
                config: { resolve: () => CONFIG },
                log: { info: (o: any) => logged.push(o), warn: (o: any) => logged.push(o), error: (o: any) => logged.push(o) },
                telemetry: {
                    flush: async () => undefined,
                    useFile: async ({ file }: any) => { const previous = state.procs.telemetry.file; state.procs.telemetry.file = file; return { previous, file }; },
                },
                ui: {
                    escape: ({ text }: any) => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)),
                    badge: ({ text }: any) => `<span>${text}</span>`,
                    alert: ({ title, text }: any) => `<div class="alert">${title}: ${text}</div>`,
                    sparkline: () => "<svg></svg>",
                },
                db: { select: async () => [] },
            },
            telemetry: {} as any,
        },
    };
    // The plugin calls itself through ctx.fns.telemetry; wire the real functions.
    const bind = (fn: any) => (opts: any = {}) => fn(ctx, null, opts);
    Object.assign(ctx.fns.telemetry, {
        paths: bind(paths), pageName: bind(pageName), humanBytes: bind(humanBytes),
        spanSource: bind(spanSource), rotate: bind(rotate), compact: bind(compact),
        prune: bind(prune), storage: bind(storage), stats: bind(stats), duck: bind(duck),
        chart: bind(chart), dirBytes: bind((await import("./dirBytes")).default), pgStats: bind(pgStats),
    });
    return { ctx, runtime };
}

const span = (overrides: Record<string, any> = {}) => JSON.stringify({
    Timestamp: new Date().toISOString(), TraceId: "t1", SpanId: "s1", Name: "db.query",
    DurationMs: 12.5, Status: "ok",
    Attributes: { "http.route": "/x", "db.query.summary": "SELECT ? FROM t" },
    ...overrides,
}) + "\n";

describe("telemetry storage", () => {
    test("humanBytes scales to the largest sensible unit", () => {
        expect(humanBytes(null as any, null, { bytes: 512 })).toBe("512 B");
        expect(humanBytes(null as any, null, { bytes: 2048 })).toBe("2.0 KB");
        expect(humanBytes(null as any, null, { bytes: 5 * 1024 ** 3 })).toBe("5.0 GB");
    });

    test("pageName embeds the day and the process", () => {
        const name = pageName(null as any, null, { now: Date.UTC(2026, 9, 4, 12, 30), pid: 42 });
        expect(name).toBe("spans-20261004T123000-42.ndjson");
    });

    test("paths creates the three tiers under the runtime directory", async () => {
        const { ctx, runtime } = await makeCtx();
        const layout = await ctx.fns.telemetry.paths({});
        expect(layout.root).toBe(`${runtime}/telemetry`);
        for (const dir of [layout.open, layout.pages, layout.cold]) {
            expect((await stat(dir)).isDirectory()).toBe(true);
        }
    });

    test("rotate adopts an unrotated legacy file as a closed page", async () => {
        const { ctx, runtime } = await makeCtx();
        await writeFile(`${runtime}/telemetry.ndjson`, span());
        const result = await ctx.fns.telemetry.rotate({});
        expect(result.rotated).toBe(true);
        expect(result.closed).toContain("/pages/");
        expect(ctx.state.procs.telemetry.file).toContain("/open/");
        const closed = await readdir(`${runtime}/telemetry/pages`);
        expect(closed).toHaveLength(1);
    });

    test("rotate leaves a small fresh page alone and closes a full one", async () => {
        const { ctx } = await makeCtx();
        await ctx.fns.telemetry.rotate({});                       // adopt, open page 1
        await writeFile(ctx.state.procs.telemetry.file, span());  // well under pageBytes
        expect((await ctx.fns.telemetry.rotate({})).rotated).toBe(false);
        await writeFile(ctx.state.procs.telemetry.file, span().repeat(40)); // over 1 KB
        expect((await ctx.fns.telemetry.rotate({})).rotated).toBe(true);
    });

    test("storage never counts the legacy file twice while it is still the open page", async () => {
        const { ctx, runtime } = await makeCtx();
        await writeFile(`${runtime}/telemetry.ndjson`, span());
        const before = await ctx.fns.telemetry.storage({});
        expect(before.legacyBytes).toBe(0);
        expect(before.totalBytes).toBe(before.openPage.bytes);
    });

    test("prune deletes partitions older than the retention and keeps the rest", async () => {
        const { ctx, runtime } = await makeCtx();
        const cold = `${runtime}/telemetry/cold`;
        await mkdir(`${cold}/dt=2020-01-01`, { recursive: true });
        await mkdir(`${cold}/dt=${new Date().toISOString().slice(0, 10)}`, { recursive: true });
        const result = await ctx.fns.telemetry.prune({ days: 30 });
        expect(result.removed).toEqual(["dt=2020-01-01"]);
        expect(result.kept).toBe(1);
    });

    test("prune with days=0 keeps everything", async () => {
        const { ctx, runtime } = await makeCtx();
        await mkdir(`${runtime}/telemetry/cold/dt=2020-01-01`, { recursive: true });
        expect((await ctx.fns.telemetry.prune({ days: 0 })).removed).toEqual([]);
    });

    test("spanSource returns a typed empty relation when no span file exists", async () => {
        const { ctx } = await makeCtx();
        const source = await ctx.fns.telemetry.spanSource({});
        expect(source.hot).toBe(false);
        expect(source.cold).toBe(false);
        expect(source.sql).toContain("WHERE false");
    });

    test("spanSource names only the tiers that actually have files", async () => {
        const { ctx } = await makeCtx();
        await ctx.fns.telemetry.rotate({});
        await writeFile(ctx.state.procs.telemetry.file, span());
        const source = await ctx.fns.telemetry.spanSource({});
        expect(source.hot).toBe(true);
        expect(source.cold).toBe(false);
        expect(source.sql).toContain("read_ndjson");
        expect(source.sql).not.toContain("read_parquet");
    });
});

describe("telemetry queries", () => {
    const hasDuckdb = Bun.which("duckdb") !== null;

    test.if(hasDuckdb)("duck reports a bad statement instead of throwing", async () => {
        const { ctx } = await makeCtx();
        const result = await ctx.fns.telemetry.duck({ sql: "SELECT nonexistent_fn()" });
        expect(result.ok).toBe(false);
        expect(result.rows).toEqual([]);
    });

    test("duck reports a missing binary instead of throwing", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.procs.config.resolve = () => ({ ...CONFIG, duckdbBin: "/nonexistent/duckdb-binary" });
        const result = await ctx.fns.telemetry.duck({ sql: "SELECT 1" });
        expect(result.ok).toBe(false);
        expect(result.rows).toEqual([]);
    });

    test.if(hasDuckdb)("compact converts a closed page to parquet and removes it", async () => {
        const { ctx, runtime } = await makeCtx();
        await writeFile(`${runtime}/telemetry.ndjson`, span() + span({ Name: "llm.request", DurationMs: 900 }));
        await ctx.fns.telemetry.rotate({});
        const result = await ctx.fns.telemetry.compact({});
        expect(result.converted).toBe(1);
        expect(result.failed).toEqual([]);
        expect(await readdir(`${runtime}/telemetry/pages`)).toEqual([]);
        const partitions = await readdir(`${runtime}/telemetry/cold`);
        expect(partitions[0]).toStartWith("dt=");
    });

    test.if(hasDuckdb)("stats aggregates spans across hot and cold tiers", async () => {
        const { ctx, runtime } = await makeCtx();
        await writeFile(`${runtime}/telemetry.ndjson`, span() + span({ Name: "llm.request", DurationMs: 2500, Status: "error" }));
        await ctx.fns.telemetry.rotate({});
        await ctx.fns.telemetry.compact({});
        await writeFile(ctx.state.procs.telemetry.file, span({ DurationMs: 3 }));

        const result = await ctx.fns.telemetry.stats({ hours: 24, limit: 5 });
        expect(result.ok).toBe(true);
        expect(result.tiers).toEqual({ hot: true, cold: true });
        expect(result.totals.spans).toBe(3);
        expect(result.totals.errors).toBe(1);
        expect(result.kinds.map((k: any) => k.name).sort()).toEqual(["db.query", "llm.request"]);
        expect(result.routes[0].route).toBe("/x");
        expect(result.queries[0].query).toBe("SELECT ? FROM t");
    });

    test.if(hasDuckdb)("stats stays empty and ok when nothing has been recorded", async () => {
        const { ctx } = await makeCtx();
        const result = await ctx.fns.telemetry.stats({ hours: 1 });
        expect(result.ok).toBe(true);
        expect(result.totals.spans).toBe(0);
        expect(result.kinds).toEqual([]);
    });
});

describe("telemetry postgres statements", () => {
    test("pgStats says what is missing when the extension is not installed", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.procs.db.select = async () => [];
        const result = await ctx.fns.telemetry.pgStats({});
        expect(result.available).toBe(false);
        expect(result.reason).toContain("not installed");
        expect(result.rows).toEqual([]);
    });

    test("pgStats explains the preload requirement instead of throwing", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.procs.db.select = async ({ sql }: any) => {
            if (sql.includes("pg_extension")) return [{ "?column?": 1 }];
            throw new Error('pg_stat_statements must be loaded via "shared_preload_libraries"');
        };
        const result = await ctx.fns.telemetry.pgStats({});
        expect(result.available).toBe(false);
        expect(result.reason).toContain("not preloaded");
    });

    test("pgStats normalizes rows and computes the cache hit ratio", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.procs.db.select = async ({ sql }: any) => {
            if (sql.includes("pg_extension")) return [{ "?column?": 1 }];
            if (sql.includes("pg_stat_statements_info")) return [{ since: "2026-10-04 21:10" }];
            return [{
                query: "SELECT  *\n  FROM agents", calls: "22", total_sec: "27.3", mean_ms: "1243.02",
                max_ms: "1600", rows: "7656", rows_per_call: "348", hit_percent: "47.2", shared_blks_read: "900",
            }];
        };
        const result = await ctx.fns.telemetry.pgStats({ limit: 5 });
        expect(result.available).toBe(true);
        expect(result.since).toBe("2026-10-04 21:10");
        expect(result.rows[0]).toMatchObject({ query: "SELECT * FROM agents", calls: 22, totalSec: 27.3, hitPercent: 47.2 });
    });

    test("dashboard shows the postgres panel and its diagnosis when unavailable", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.telemetry.stats = async () => ({
            ok: true, error: null, hours: 1, tiers: { hot: true, cold: false },
            totals: { spans: 1, errors: 0, traces: 1, from: "a", to: "b" },
            kinds: [], routes: [], queries: [], slow: [], traffic: [],
        });
        ctx.fns.telemetry.pgStats = async () => ({ available: false, reason: "pg_stat_statements is not installed", since: null, rows: [] });
        const html = await dashboard(ctx, null, { hours: 1 });
        expect(html).toContain("Postgres statements");
        expect(html).toContain("pg_stat_statements is not installed");
    });
});

describe("telemetry dashboard", () => {
    test("chart falls back to a sparkline when vega-lite is absent", async () => {
        const { ctx } = await makeCtx();
        const points = [
            { bucket: "10-04 10:00", count: 5, errors: 0, p95: 10 },
            { bucket: "10-04 10:30", count: 9, errors: 1, p95: 40 },
        ];
        expect(await ctx.fns.telemetry.chart({ points })).toBe("<svg></svg>");
    });

    test("chart says so rather than drawing a line through one point", async () => {
        const { ctx } = await makeCtx();
        const html = await ctx.fns.telemetry.chart({ points: [{ bucket: "a", count: 1, errors: 0, p95: 1 }] });
        expect(html).toContain("not enough data");
    });

    test("dashboard explains itself when the query layer is unavailable", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.telemetry.stats = async () => ({ ok: false, error: "duckdb missing", hours: 24, tiers: { hot: false, cold: false }, totals: { spans: 0, errors: 0, traces: 0, from: null, to: null }, kinds: [], routes: [], queries: [], slow: [], traffic: [] });
        const html = await dashboard(ctx, null, { hours: 24 });
        expect(html).toContain("Cannot read span storage");
        expect(html).toContain("duckdb missing");
    });

    test("dashboard renders every section from statistics", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.telemetry.stats = async () => ({
            ok: true, error: null, hours: 24, tiers: { hot: true, cold: true },
            totals: { spans: 1000, errors: 3, traces: 400, from: "10-03 20:00", to: "10-04 20:00" },
            kinds: [{ name: "db.query", count: 900, errors: 1, p50: 1, p95: 9, max: 200, totalSec: 12 }],
            routes: [{ route: "/llms/usage", count: 500, p50: 1, p95: 700, max: 900, totalSec: 60 }],
            queries: [{ query: "SELECT ? FROM agents", count: 40, p95: 800, totalSec: 30 }],
            slow: [{ ts: "10-04 20:00:01", name: "llm.request", ms: 9000, status: "error", detail: "boom", traceId: "t9" }],
            traffic: [{ bucket: "a", count: 1, errors: 0, p95: 2 }, { bucket: "b", count: 4, errors: 1, p95: 9 }],
        });
        const html = await dashboard(ctx, null, { hours: 24 });
        expect(html).toContain("Span volume");
        expect(html).toContain("/llms/usage");
        expect(html).toContain("SELECT ? FROM agents");
        expect(html).toContain("llm.request");
        expect(html).toContain("1,000");
    });

    test("dashboard escapes attacker-controlled attribute text", async () => {
        const { ctx } = await makeCtx();
        ctx.fns.telemetry.stats = async () => ({
            ok: true, error: null, hours: 1, tiers: { hot: true, cold: false },
            totals: { spans: 1, errors: 0, traces: 1, from: "a", to: "b" },
            kinds: [], routes: [{ route: "/<script>alert(1)</script>", count: 1, p50: 1, p95: 1, max: 1, totalSec: 1 }],
            queries: [], slow: [], traffic: [],
        });
        const html = await dashboard(ctx, null, { hours: 1 });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });
});
