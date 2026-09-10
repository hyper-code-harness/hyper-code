import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import loader from "./$loader_app";
import items from "./items";

async function tempApp(value: Record<string, any>) {
    const path = `/tmp/hyper-app-${crypto.randomUUID()}.json`;
    await Bun.write(path, JSON.stringify(value));
    return path;
}

test("app loader collects navigation metadata", async () => {
    const ctx: any = await mkTestCtx();
    const path = await tempApp({ label: "cron tasks", href: "/cron", hint: "jobs", icon: "ph-clock", group: "System", order: 80 });
    await loader(ctx, null, { entries: [{ name: "cron", rel: "cron/$app_cron.json", abs: path }] });
    expect(ctx.state.nav.apps.cron).toEqual({ name: "cron", label: "cron tasks", href: "/cron", hint: "jobs", icon: "ph-clock", group: "System", order: 80 });
    await Bun.file(path).delete();
    await ctx.fns.procs.db.close?.({});
});

test("nav items orders declared apps and exposes presentation metadata", async () => {
    const ctx: any = await mkTestCtx();
    const late = await tempApp({ label: "late", href: "/late", order: 20 });
    const early = await tempApp({ label: "early", href: "/early", order: 10, icon: "ph-star", group: "Projects & files" });
    await loader(ctx, null, { entries: [{ name: "late", rel: "$app_late.json", abs: late }, { name: "early", rel: "$app_early.json", abs: early }] });
    ctx.fns.plugins.list = () => [];
    ctx.fns.session.list = async () => [];
    ctx.state.procs.http.routes = {};
    const result = await items(ctx, null, { limit: 10 });
    expect(result.map(item => item.label)).toEqual(["early", "late"]);
    expect(result[0]).toMatchObject({ icon: "ph-star", group: "Projects & files", order: 10 });
    await Promise.all([Bun.file(late).delete(), Bun.file(early).delete()]);
    await ctx.fns.procs.db.close?.({});
});

test("nav items discovers parameterless GET pages but excludes assets and parameterized routes", async () => {
    const ctx: any = await mkTestCtx();
    ctx.state.nav = { apps: {} };
    ctx.state.procs.http.routes = {
        "/gaps": { GET: Object.assign(async () => {}, { from: "flow/gaps/$route__GET.ts" }) },
        "/ui/app.js": { GET: async () => {} },
        "/agent/:id": { GET: async () => {} },
        "/api/mobile/v1/news": { GET: async () => {} },
    };
    ctx.fns.plugins.list = () => [];
    ctx.fns.session.list = async () => [];
    const result = await items(ctx, null, { limit: 20 });
    expect(result).toContainEqual(expect.objectContaining({ href: "/gaps", label: "Gaps", group: "Pages" }));
    expect(result.map(item => item.href)).not.toContain("/ui/app.js");
    expect(result.map(item => item.href)).not.toContain("/agent/:id");
    expect(result.map(item => item.href)).not.toContain("/api/mobile/v1/news");
    await ctx.fns.procs.db.close?.({});
});


test("app loader rejects external URLs and invalid icon classes", async () => {
    const ctx: any = await mkTestCtx();
    const external = await tempApp({ label: "bad", href: "https://example.com" });
    await expect(loader(ctx, null, { entries: [{ name: "bad", rel: "$app_bad.json", abs: external }] })).rejects.toThrow("local absolute URL");
    const icon = await tempApp({ label: "bad", href: "/bad", icon: "clock" });
    await expect(loader(ctx, null, { entries: [{ name: "bad", rel: "$app_bad.json", abs: icon }] })).rejects.toThrow("Phosphor class");
    await Promise.all([Bun.file(external).delete(), Bun.file(icon).delete()]);
    await ctx.fns.procs.db.close?.({});
});
