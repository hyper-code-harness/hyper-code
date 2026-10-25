import { test, expect } from "bun:test";
import route from "./$route_$name_GET";

function fixture(options: { unavailable?: boolean; missing?: boolean } = {}) {
    let configurationCalls = 0;
    let markdownCalls = 0;
    const module = {
        name: "example", label: "Example", dir: "/project/plugins/example", source: "official",
        description: "Example plugin", icon: "ph-plug", plugin: true, optional: false,
        fns: ["example.query"], routes: [], namespaces: ["example"], skill: import.meta.path,
    };
    const ctx = { fns: {
        procs: {
            modules: { list: () => options.missing ? [] : [module] },
            project: { projectRoot: () => "/project" },
            ui: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text), attr: () => "" },
        },
        w: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text), marks: () => "" },
        runtime: { docs: { get: () => ({ name: "example.query", summary: "Query rows", doc: "Query rows", returnType: "Promise<Row[]>", paramsSchema: { properties: { limit: { type: "number", description: "Maximum rows.", default: 1000, minimum: 1, maximum: 10000 } } } }) } },
        markdown: { render: () => { markdownCalls++; return "<p>Rendered skill instructions</p>"; } },
        plugins: { configurationPage: async ({ name }: { name: string }) => {
            configurationCalls++;
            expect(name).toBe("example");
            if (options.unavailable) throw new Error("private-token-do-not-leak");
            return "<section>Declared fields, secrets and widget</section>";
        } },
    } } as unknown as Context;
    return { ctx, configurationCalls: () => configurationCalls, markdownCalls: () => markdownCalls };
}

async function page(f: ReturnType<typeof fixture>, query = "") {
    return await route(f.ctx, null, { req: new Request("http://localhost/plugins/example" + query), params: { name: "example" } });
}

for (const query of ["", "?tab=overview", "?tab=invalid"]) {
    test(`overview default and safe fallback ${query}`, async () => {
        const f = fixture();
        const result = await page(f, query);
        if (result instanceof Response) throw new Error("Unexpected response");
        expect(result.main).toContain("Rendered skill instructions");
        expect(result.main).toContain('aria-label="Plugin sections"');
        expect(result.main).toContain('?tab=overview" aria-current="page"');
        expect(result.main).toContain('?tab=settings"');
        expect(result.main).toContain('?tab=functions"');
        expect(result.main).not.toContain("Runtime functions");
        expect(f.configurationCalls()).toBe(0);
    });
}

test("functions tab renders generated schemas without settings widgets or skill rendering", async () => {
    const f = fixture();
    const result = await page(f, "?tab=functions");
    if (result instanceof Response) throw new Error("Unexpected response");
    expect(result.main).toContain("Runtime functions");
    expect(result.main).toContain("example.query");
    expect(result.main).toContain("Maximum rows.");
    expect(result.main).toContain("Promise&lt;Row[]&gt;");
    expect(result.main).toContain("1/1 documented");
    expect(result.main).toContain("default 1000 · min 1 · max 10000");
    expect(result.main).toContain('?tab=functions" aria-current="page"');
    expect(f.configurationCalls()).toBe(0);
    expect(f.markdownCalls()).toBe(0);
});

test("settings tab embeds configuration exactly once", async () => {
    const f = fixture();
    const result = await page(f, "?tab=settings");
    if (result instanceof Response) throw new Error("Unexpected response");
    expect(result.main).toContain("Declared fields, secrets and widget");
    expect(result.main).toContain('?tab=settings" aria-current="page"');
    expect(result.main).not.toContain("Runtime functions");
    expect(f.configurationCalls()).toBe(1);
    expect(f.markdownCalls()).toBe(0);
});

test("settings resolver failure never exposes raw errors", async () => {
    const f = fixture({ unavailable: true });
    const result = await page(f, "?tab=settings");
    if (result instanceof Response) throw new Error("Unexpected response");
    expect(result.main).toContain("Plugin settings unavailable.");
    expect(result.main).not.toContain("private-token");
});

test("unmounted plugin returns 404 without executing settings", async () => {
    const f = fixture({ missing: true });
    const result = await page(f, "?tab=settings");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(f.configurationCalls()).toBe(0);
});
