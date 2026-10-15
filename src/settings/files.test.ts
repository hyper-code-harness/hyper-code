import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";

async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "hyper-settings-"));
    const ctx = await mkTestCtx({ env: { HYPER_SETTINGS: dir } });
    return { ctx, dir };
}

describe("instance settings files ($settings_<module>.json)", () => {
    test("a file value wins over db and env, and set() refuses it", async () => {
        const { ctx, dir } = await setup();
        await ctx.fns.settings.set({ module: "llm", scopeType: "global", key: "lmstudioBaseUrl", value: "http://db" });
        ctx.env.LMSTUDIO_URL = "http://env";
        await writeFile(join(dir, "$settings_llm.json"), JSON.stringify({ lmstudioBaseUrl: "http://file" }));
        await ctx.fns.settings.files({ force: true });
        expect(await ctx.fns.settings.get({ module: "llm", scopeType: "global", key: "lmstudioBaseUrl" })).toBe("http://file");
        const item = (await ctx.fns.settings.declared({})).find((i: any) => i.module === "llm" && i.key === "lmstudioBaseUrl");
        expect(item.source).toBe("file");
        expect(item.path).toBe(join(dir, "$settings_llm.json"));
        await expect(ctx.fns.settings.set({ module: "llm", scopeType: "global", key: "lmstudioBaseUrl", value: "x" })).rejects.toThrow(/fixed by/);
        // personal and other scopes are not affected by instance files
        await ctx.fns.settings.set({ module: "llm", scopeType: "user", scopeId: "u1", key: "defaultModel", value: "mine" });
        expect(await ctx.fns.settings.get({ module: "llm", scopeType: "user", scopeId: "u1", key: "defaultModel" })).toBe("mine");
    });

    test("undeclared keys warn, wrong types and secrets are rejected", async () => {
        const { ctx, dir } = await setup();
        await writeFile(join(dir, "$settings_agent.json"), JSON.stringify({ debounceMs: "fast", nope: 1 }));
        const r = await ctx.fns.settings.files({ force: true });
        expect(r.values["agent.debounceMs"]).toBeUndefined();
        expect(r.errors.join("\n")).toMatch(/agent\.debounceMs" expected a number/);
        expect(r.warnings.join("\n")).toMatch(/agent\.nope" is not declared/);
    });

    test("broken JSON keeps the last good values", async () => {
        const { ctx, dir } = await setup();
        const file = join(dir, "$settings_agent.json");
        await writeFile(file, JSON.stringify({ debounceMs: 42 }));
        expect((await ctx.fns.settings.files({ force: true })).values["agent.debounceMs"]?.value).toBe(42);
        await writeFile(file, "{ broken");
        const later = new Date(Date.now() + 5000);
        await utimes(file, later, later);
        const r = await ctx.fns.settings.files({ force: true });
        expect(r.values["agent.debounceMs"]?.value).toBe(42);
        expect(r.errors[0]).toMatch(/keeping the last good values/);
    });

    test("nav.pages picks and orders the Pages widget", async () => {
        const { ctx, dir } = await setup();
        await writeFile(join(dir, "$settings_nav.json"), JSON.stringify({ pages: ["settings", "search", "missing"] }));
        await ctx.fns.settings.files({ force: true });
        const widget = (ctx.state as any).nav.widgets["pages"];
        const out = await widget.render(ctx, {});
        expect(out.items.map((i: any) => i.href)).toEqual(["/settings", "/search"]);
        expect(out.sections).toBeUndefined();
    });
});
