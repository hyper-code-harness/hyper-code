import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("an instance sets its own favicon: pages and /favicon.ico serve it, reset brings back the built-in one", async () => {
    const ctx: any = await mkTestCtx();
    const builtIn = await ctx.fns.ui.faviconUrl({});
    expect(builtIn).toStartWith("data:image/svg+xml,");

    await ctx.fns.ui.setFavicon({ emoji: "🧪", background: "#dc2626" });
    const custom = await ctx.fns.ui.faviconUrl({});
    expect(decodeURIComponent(custom)).toContain("🧪");
    expect(decodeURIComponent(custom)).toContain("#dc2626");
    const page = await ctx.fns.ui.layout({ main: "<p>x</p>" });
    expect(page).toContain(`<link rel="icon" href="${Bun.escapeHTML(custom)}">`);

    const ico = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/favicon.ico" });
    expect(ico.status).toBe(200);
    expect(ico.headers.get("content-type")).toBe("image/svg+xml");
    expect(await ico.text()).toContain("🧪");

    const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await ctx.fns.ui.setFavicon({ dataUrl: png });
    const pngRes = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/favicon.ico" });
    expect(pngRes.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await pngRes.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    await expect(ctx.fns.ui.setFavicon({ dataUrl: "javascript:alert(1)" })).rejects.toThrow("data:image");
    await expect(ctx.fns.ui.setFavicon({ emoji: "a", svg: "<svg/>" })).rejects.toThrow("exactly one");

    await ctx.fns.ui.setFavicon({ reset: true });
    expect(await ctx.fns.ui.faviconUrl({})).toBe(builtIn);
});
