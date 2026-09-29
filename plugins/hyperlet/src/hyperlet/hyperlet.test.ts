import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testCtx } from "../../../../src/$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

test("config/list/write round-trip on a private agent config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperlet-plugin-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ controlPlane: "https://cp.test/", tokenFile: join(dir, "token"), listen: "100.1.1.1",
        intent: { version: 2, tenant: "cs", node: "n1", services: [{ name: "hyper", port: 3443, scheme: "https", kind: "hyper", health: "/auth/login" }] } }), { mode: 0o600 });
    try {
        const cfg = await ctx.fns.hyperlet.config({ path });
        expect(cfg.tenant).toBe("cs");
        writeFileSync(join(dir, "state.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, hosts: ["hyper.cs.in.hs.hyper-mesh.xyz"], services: ["hyper"], down: [], refused: [] }));
        const list = await ctx.fns.hyperlet.list({ path });
        expect(list[0]).toMatchObject({ name: "hyper", url: "https://hyper.cs.in.hs.hyper-mesh.xyz", routed: true, up: true });
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
