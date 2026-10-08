import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import dataRoot from "./dataRoot";
import inlineData from "./inlineData";
import readData from "./readData";
import render from "./render";
import resolveDataPath from "./resolveDataPath";
import theme from "./theme";
import fence from "./$fence_vega-lite";
import route from "./$route_data_GET";

// A ctx with just the pieces these functions reach for: the data root points at
// a scratch directory, so the confinement tests prove the check and not the
// accident that the repo has no /etc/passwd in it.
let root = "";
function makeCtx(settings: Record<string, unknown> = {}): Context {
    const self: any = {
        env: {},
        state: {},
        fns: {
            settings: {
                get: async (opts: any) => settings[opts.key],
                getString: async (opts: any) => (typeof settings[opts.key] === "string" ? settings[opts.key] : opts.fallback),
                getNumber: async (opts: any) => (typeof settings[opts.key] === "number" ? settings[opts.key] : opts.fallback),
            },
            procs: { project: { projectRoot: () => root } },
            vegalite: {} as Record<string, Function>,
        },
    };
    self.fns.vegalite = {
        dataRoot: (opts: any = {}) => dataRoot(self, null, opts),
        resolveDataPath: (opts: any) => resolveDataPath(self, null, opts),
        readData: (opts: any) => readData(self, null, opts),
        inlineData: (opts: any) => inlineData(self, null, opts),
        render: (opts: any) => render(self, null, opts),
        theme: (opts: any = {}) => theme(self, null, opts),
    };
    return self as Context;
}

const BAR = {
    data: { values: [{ a: "A", b: 28 }, { a: "B", b: 55 }] },
    mark: "bar",
    encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
};

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "vegalite-test-"));
    await writeFile(join(root, "sales.csv"), "month,sales\nJan,120\nFeb,180\nMar,150\n");
    await writeFile(join(root, "rows.json"), JSON.stringify([{ a: "A", b: 1 }, { a: "B", b: 2 }]));
    await writeFile(join(root, "rows.ndjson"), '{"a":"A","b":1}\n{"a":"B","b":2}\n');
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("vegalite.render", () => {
    test("renders a spec to an inline svg", async () => {
        const result = await render(makeCtx(), null, { spec: BAR });
        expect(result.html).toContain('class="vegalite-chart"');
        expect(result.svg).toContain("<svg");
        expect(result.svg).toContain('preserveAspectRatio="xMinYMin meet"');
        expect(result.sources).toEqual([]);
    });

    test("accepts a spec as a JSON string and reports bad JSON", async () => {
        const ok = await render(makeCtx(), null, { spec: JSON.stringify(BAR) });
        expect(ok.svg).toContain("<svg");
        await expect(render(makeCtx(), null, { spec: "{ broken" })).rejects.toThrow(/not valid JSON/);
    });

    test("an invalid spec throws instead of rendering an empty chart", async () => {
        await expect(render(makeCtx(), null, { spec: {} })).rejects.toThrow(/vegalite:/);
    });

    test("width and height override the spec, composed specs are left alone", async () => {
        const narrow = await render(makeCtx(), null, { spec: BAR, width: 120, height: 90 });
        const wide = await render(makeCtx(), null, { spec: BAR, width: 600, height: 90 });
        const widthOf = (svg: string) => Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1]);
        expect(widthOf(wide.svg)).toBeGreaterThan(widthOf(narrow.svg));

        const layered = { layer: [BAR, { ...BAR, mark: "point" }] };
        const result = await render(makeCtx(), null, { spec: layered, width: 300 });
        expect(result.svg).toContain("<svg");
    });

    test("the theme is applied unless turned off", async () => {
        const themed = await render(makeCtx(), null, { spec: BAR });
        expect(themed.svg).toContain("Inter");
        const plain = await render(makeCtx(), null, { spec: BAR, theme: false });
        expect(plain.svg).not.toContain("Inter");
    });

    test("no script or style element reaches the page", async () => {
        const result = await render(makeCtx(), null, { spec: BAR });
        expect(result.html).not.toContain("<script");
        // The host sanitizer strips <style> blocks, so a chart that needed one
        // would silently lose its colours.
        expect(result.html).not.toContain("<style");
    });
});

describe("data confinement", () => {
    test("a relative url under the data root is inlined", async () => {
        const result = await render(makeCtx(), null, {
            spec: { data: { url: "sales.csv" }, mark: "line", encoding: { x: { field: "month", type: "nominal" }, y: { field: "sales", type: "quantitative" } } },
        });
        expect(result.sources).toEqual([{ url: "sales.csv", rows: 3, bytes: 36, remote: false }]);
        expect(result.svg).toContain("<svg");
    });

    test("every url in a layered spec is resolved", async () => {
        const encoding = { x: { field: "month", type: "nominal" }, y: { field: "sales", type: "quantitative" } };
        const result = await render(makeCtx(), null, {
            spec: { layer: [{ data: { url: "sales.csv" }, mark: "line", encoding }, { data: { url: "sales.csv" }, mark: "point", encoding }] },
        });
        expect(result.sources.map(s => s.rows)).toEqual([3, 3]);
    });

    test("an agent's local workspace becomes the root, and the setting still wins", async () => {
        // Charts written in chat name the paths the agent's own tools just used.
        const ws = await mkdtemp(join(tmpdir(), "vegalite-ws-"));
        const localAgent = { agent: { workspaceDir: ws, workspaceHost: "" } } as unknown as Session;
        expect(await dataRoot(makeCtx(), localAgent, {})).toBe(ws);

        // A remote workspace is not a readable local path.
        const remoteAgent = { agent: { workspaceDir: "/srv/data", workspaceHost: "box" } } as unknown as Session;
        expect(await dataRoot(makeCtx(), remoteAgent, {})).toBe(root);

        // An explicit setting is the deliberate choice and outranks the workspace.
        expect(await dataRoot(makeCtx({ dataRoot: "." }), localAgent, {})).toBe(root);

        await rm(ws, { recursive: true, force: true });
    });

    test("a path escaping the data root is refused", async () => {
        await expect(resolveDataPath(makeCtx(), null, { path: "../../etc/passwd" })).rejects.toThrow(/escapes the data root/);
        await expect(resolveDataPath(makeCtx(), null, { path: "/etc/passwd" })).rejects.toThrow(/escapes the data root/);
        await expect(resolveDataPath(makeCtx(), null, { path: "" })).rejects.toThrow(/empty data path/);
    });

    test("a remote url is refused while allowRemoteData is off", async () => {
        await expect(inlineData(makeCtx(), null, { spec: { data: { url: "https://example.com/x.json" } } }))
            .rejects.toThrow(/remote data is disabled/);
    });

    test("data.sql is refused while allowSqlData is off", async () => {
        await expect(inlineData(makeCtx(), null, { spec: { data: { sql: "SELECT 1" } } }))
            .rejects.toThrow(/data.sql is disabled/);
    });

    test("data.sql runs through duckdb and is inlined as rows", async () => {
        const ctx = makeCtx({ allowSqlData: true });
        let asked = "";
        (ctx.fns as any).duckdb = {
            query: async (opts: any) => {
                asked = opts.sql;
                return { rows: [{ month: "Jan", sales: 120 }], rowCount: 1, truncated: false };
            },
        };
        const result = await inlineData(ctx, null, { spec: { data: { sql: "SELECT month, sales FROM t" }, mark: "bar" } });
        expect(asked).toBe("SELECT month, sales FROM t");
        expect((result.spec.data as any).values).toEqual([{ month: "Jan", sales: 120 }]);
        expect((result.spec.data as any).sql).toBeUndefined();
        expect(result.sources[0]!.url).toBe("sql:SELECT month, sales FROM t");
    });

    test("data.sql without the duckdb plugin says so", async () => {
        await expect(inlineData(makeCtx({ allowSqlData: true }), null, { spec: { data: { sql: "SELECT 1" } } }))
            .rejects.toThrow(/needs the duckdb plugin/);
    });


    test("a file over the size cap is refused by size, not truncated", async () => {
        const ctx = makeCtx({ maxDataBytes: 10 });
        await expect(readData(ctx, null, { path: "sales.csv" })).rejects.toThrow(/too large/);
    });

    test("csv, json and ndjson parse to the same shape", async () => {
        const ctx = makeCtx();
        expect((await readData(ctx, null, { path: "sales.csv" })).rows[0]).toEqual({ month: "Jan", sales: 120 });
        expect((await readData(ctx, null, { path: "rows.json" })).rows).toHaveLength(2);
        expect((await readData(ctx, null, { path: "rows.ndjson" })).rows).toHaveLength(2);
        const limited = await readData(ctx, null, { path: "sales.csv", limit: 2 });
        expect(limited.rows).toHaveLength(2);
        expect(limited.truncated).toBe(true);
    });
});

describe("markdown fence", () => {
    test("reads width, height and theme from the fence info string", async () => {
        const ctx = makeCtx();
        const html = await fence(ctx, null, { source: JSON.stringify(BAR), lang: "vega-lite", info: "width=600 height=200 theme=off" });
        expect(html).toContain('class="vegalite-chart"');
        expect(html).not.toContain("Inter");
    });

    test("a broken spec throws so markdown keeps the block as code", async () => {
        await expect(fence(makeCtx(), null, { source: "{ broken", lang: "vega-lite", info: "" })).rejects.toThrow();
    });
});

describe("GET /vegalite/data", () => {
    const call = (query: string) => route(makeCtx(), null, { req: new Request(`http://local/vegalite/data?${query}`), params: {} });

    test("serves a file and its parsed rows", async () => {
        const raw = await call("path=sales.csv");
        expect(raw.status).toBe(200);
        expect(raw.headers.get("content-type")).toContain("text/csv");
        expect(await raw.text()).toContain("Jan,120");

        const rows = await call("path=sales.csv&rows=1&limit=2");
        const body = await rows.json() as any;
        expect(body.rows).toHaveLength(2);
        expect(body.truncated).toBe(true);
    });

    test("refuses escapes, urls and a missing path with 400, unknown file with 404", async () => {
        expect((await call("path=../../etc/passwd")).status).toBe(400);
        expect((await call("path=/etc/passwd")).status).toBe(400);
        expect((await call("path=https://evil.example/x.json")).status).toBe(400);
        expect((await call("")).status).toBe(400);
        expect((await call("path=nope.csv")).status).toBe(404);
    });
});
