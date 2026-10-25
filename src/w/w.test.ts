import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("Action: exactly one kind, explicit request semantics, confirm on every kind", async () => {
    const ctx: any = await mkTestCtx();
    const A = (action: any) => ctx.fns.w.actionAttrs({ action });
    expect(() => A({})).toThrow(/exactly one/);
    expect(() => A({ href: "/a", post: "/b" })).toThrow(/exactly one/);
    expect(() => A({ get: "/x" })).toThrow(/target/);
    expect(A({ post: "/x" }).attrs).toContain('hx-swap="none"');
    expect(A({ get: "/x", target: "#out" }).attrs).toContain('hx-swap="innerHTML"');
    expect(A({ action: "go", confirm: "Sure?" }).attrs).toContain('hx-confirm="Sure?"');
    const pop = A({ popover: "m1" });
    expect(pop.attrs).toContain('anchor-name:--m1');
    expect(pop.attrs).toContain('aria-haspopup="true"');
});

test("URLs: local paths and http(s) only; protocol-relative and javascript: render no link", async () => {
    const ctx: any = await mkTestCtx();
    const u = (url: string, image = false) => ctx.fns.w.safeUrl({ url, image });
    expect(u("/agent/da")).toBe("/agent/da");
    expect(u("https://x.dev/a")).toBe("https://x.dev/a");
    expect(u("//evil.com")).toBeNull();
    expect(u("javascript:alert(1)")).toBeNull();
    expect(u("data:image/png;base64,AAA")).toBeNull();
    expect(u("data:image/png;base64,AAA", true)).toBe("data:image/png;base64,AAA");
    expect(ctx.fns.w.actionAttrs({ action: { href: "//evil.com" } }).tag).toBe("div");
    const msg = ctx.fns.w.message({ role: "user", html: "hi", attachments: [{ url: "javascript:x", name: "x" }, { url: "/a.png", name: "a", image: true }] });
    expect(msg).not.toContain("javascript:");
    expect(msg).toContain('src="/a.png"');
});

test("popover and menu: the opener is the widget itself — no button inside a button", async () => {
    const ctx: any = await mkTestCtx();
    const html = ctx.fns.w.menu({ id: "m", trigger: ctx.fns.w.button({ label: "Open", action: { popover: "m" } }), items: [{ label: "Copy" }, "-", { label: "Delete", danger: true }] });
    // No element opens inside another: every <button …> is closed before the next one starts.
    const opens = [...html.matchAll(/<\/?button\b/g)].map(m => m[0]);
    for (let i = 0; i < opens.length; i += 2) expect([opens[i], opens[i + 1]]).toEqual(["<button", "</button"]);
    expect(html.match(/<button/g)!.length).toBe(3); // opener + 2 items
    expect(html).toContain('role="menuitem" tabindex="-1"');
});

test("toolGroup: a folded run draws each call once", async () => {
    const ctx: any = await mkTestCtx();
    const calls = Array.from({ length: 8 }, (_, i) => ({ icon: "terminal", title: `call ${i}`, error: i === 3 }));
    const html = ctx.fns.w.toolGroup({ calls });
    expect(html.match(/class="w-tool"/g)!.length).toBe(8);
    expect(html.match(/call 3/g)!.length).toBe(2); // title + aria-label of the one cell
});

test("tabs are navigation: aria-current on the open one, no fake tablist", async () => {
    const ctx: any = await mkTestCtx();
    const html = ctx.fns.w.tabs({ items: [{ id: "a", label: "A" }, { id: "b", label: "B", close: { action: "close" } }], active: "a" });
    expect(html).not.toContain("tablist");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Close B"');
});

test("every widget in the gallery renders without an error", async () => {
    const ctx: any = await mkTestCtx();
    const a = await ctx.fns.agent.start({ model: "mock:echo" });
    const html = await ctx.fns.w.gallery({ agentId: a.id });
    expect(html).not.toContain("color:var(--w-danger);font-size:12px");
    expect((html.match(/class="wg-cell"/g) ?? []).length).toBeGreaterThan(40);
});
