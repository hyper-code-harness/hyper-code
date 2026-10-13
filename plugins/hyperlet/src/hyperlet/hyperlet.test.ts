import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testCtx } from "../../../../src/$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

test("config/list/write round-trip on a private agent config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperlet-plugin-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ controlPlane: "https://control.alpha.example/", tokenFile: join(dir, "token"), listen: "100.1.1.1",
        intent: { version: 2, tenant: "cs", node: "n1", services: [{ name: "hyper", port: 3443, scheme: "https", kind: "hyper", health: "/auth/login" }] } }), { mode: 0o600 });
    try {
        const cfg = await ctx.fns.hyperlet.config({ path });
        expect(cfg.tenant).toBe("cs");
        writeFileSync(join(dir, "state.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, hosts: ["hyper.cs.in.alpha.example"], services: ["hyper"], down: [], refused: [] }));
        const list = await ctx.fns.hyperlet.list({ path });
        expect(list[0]).toMatchObject({ name: "hyper", url: "https://hyper.cs.in.alpha.example", routed: true, up: true });
        const r = await ctx.fns.hyperlet.write({ path, wait: 0, services: [...cfg.services, { name: "demo", port: 18765, scheme: "http", kind: "http", health: "/" }] });
        expect(r.confirmed).toBe(false);
        const saved = JSON.parse(readFileSync(path, "utf8"));
        expect(saved.intent.services.map((s: any) => s.name)).toEqual(["demo", "hyper"]);
        expect(saved.tokenFile).toBe(join(dir, "token"));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("publish validates input before touching config", async () => {
    await expect(ctx.fns.hyperlet.publish({ name: "Bad_Name", port: 18765 })).rejects.toThrow(/name/);
    await expect(ctx.fns.hyperlet.publish({ name: "demo", port: 80 })).rejects.toThrow(/port/);
    await expect(ctx.fns.hyperlet.publish({ name: "demo", port: 1 + 65000 })).rejects.toThrow(/Nothing listens/);
});

test("manifest mode preserves base config and uses configured state and zone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperlet-manifest-"));
    const path = join(dir, "descriptor.json"), servicesFile = join(dir, "services.json"), stateFile = join(dir, "report.json");
    const base = { name: "base", port: 18100, scheme: "http", kind: "http", health: "/" } as const;
    const demo = { name: "demo", port: 18101, scheme: "http", kind: "http", health: "/" } as const;
    const raw = JSON.stringify({ controlPlane: "https://control.beta.example/", servicesFile, stateFile, intent: { version: 2, tenant: "team", node: "node", services: [base] } });
    writeFileSync(path, raw, { mode: 0o600 });
    try {
        await ctx.fns.hyperlet.write({ path, wait: 0, services: [base, demo] });
        expect(readFileSync(path, "utf8")).toBe(raw);
        expect(JSON.parse(readFileSync(servicesFile, "utf8"))).toEqual([demo]);
        writeFileSync(stateFile, JSON.stringify({ at: new Date().toISOString(), ok: true, hosts: ["demo.team.in.beta.example"], services: ["base", "demo"] }));
        expect((await ctx.fns.hyperlet.list({ path }))[1]).toMatchObject({ url: "https://demo.team.in.beta.example", routed: true });
        expect((await ctx.fns.hyperlet.status({ path })).services).toEqual(["base", "demo"]);
        await expect(ctx.fns.hyperlet.unpublish({ path, name: "base", wait: 0 })).rejects.toThrow(/operator-managed/);
        expect((await ctx.fns.hyperlet.unpublish({ path, name: "demo", wait: 0 })).removed).toBe(true);
        expect(JSON.parse(readFileSync(servicesFile, "utf8"))).toEqual([]);
        expect(readFileSync(path, "utf8")).toBe(raw);
        writeFileSync(path, raw.replace("control.beta.example", "unrelated.example"));
        await expect(ctx.fns.hyperlet.config({ path })).rejects.toThrow(/control\.<zone>/);
        await expect(ctx.fns.hyperlet.config({ path: join(dir, "missing.json") })).rejects.toThrow(/operator/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("publish uses explicit config path without touching the live agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperlet-publish-"));
    const path = join(dir, "config.json");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    writeFileSync(path, JSON.stringify({ controlPlane: "https://control.gamma.example/", intent: { version: 2, tenant: "team", node: "node", services: [] } }), { mode: 0o600 });
    try {
        const result = await ctx.fns.hyperlet.publish({ path, name: "demo", port: server.port!, wait: 0 });
        expect(result.url).toBe("https://demo.team.in.gamma.example");
        expect(result.confirmed).toBe(false);
        expect(result.routed).toBe(false);
        expect((await ctx.fns.hyperlet.list({ path }))[0].port).toBe(server.port!);
        expect((await ctx.fns.hyperlet.unpublish({ path, name: "demo", wait: 0 })).removed).toBe(true);
    } finally { server.stop(true); rmSync(dir, { recursive: true, force: true }); }
});
