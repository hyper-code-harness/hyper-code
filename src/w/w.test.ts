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

test("mix: named atoms merge left to right, box carries no inline style", async () => {
    const ctx: any = await mkTestCtx();
    const caption = { caption: true, ink: "faint" };
    const cls = ctx.fns.w.mix({ mixes: [caption, { ink: "muted", gap: "inside" }, false] });
    expect(cls.split(" ").sort()).toEqual(["wx-caption", "wx-gap-inside", "wx-ink-muted"]);
    const html = ctx.fns.w.box({ body: "x", mix: [{ layout: "row", gap: "s2" }, { radius: "item", line: "around" }] });
    expect(html).toBe('<div class="wx-row wx-gap-s2 wx-radius-item wx-line-around">x</div>');
    expect(html).not.toContain("style=");
});

test("stylesheet keeps the principles: grid spacing, two weights, named radii and shadow, grey hover", async () => {
    const css = await Bun.file(new URL("./$style_w.css", import.meta.url)).text();
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1]!.trim().split("\n").pop()!.trim(), body: m[2]! }))
        .filter(r => r.sel.startsWith(".w") && !r.sel.startsWith(".w-markdown"));
    const bad: string[] = [];
    for (const { sel, body } of rules) {
        for (const m of body.matchAll(/font-weight:\s*(\d+)/g)) if (!["400", "500"].includes(m[1]!)) bad.push(`${sel}: weight ${m[1]}`);
        for (const m of body.matchAll(/border-radius:\s*([^;]+)/g)) if (!/^var\(--w-radius-(frame|item|window|round)\)$|^0$/.test(m[1]!.trim())) bad.push(`${sel}: radius ${m[1]}`);
        for (const m of body.matchAll(/(?<![-\w])box-shadow:\s*([^;]+)/g)) if (/^0 \d+px \d+px/.test(m[1]!.trim())) bad.push(`${sel}: raw shadow`);
        for (const m of body.matchAll(/(?<![-\w])(?:padding|margin|gap)[\w-]*:\s*([^;]+)/g))
            for (const t of m[1]!.match(/-?[\d.]+(?:px|rem)\b/g) ?? []) {
                const px = Math.abs(t.endsWith("rem") ? parseFloat(t) * 16 : parseFloat(t));
                if (px > 2 && px % 4) bad.push(`${sel}: spacing ${t}`);
            }
        // sizes by name: numbers only for optical offsets and content widths, listed here on purpose
        const sizeOk = /badge-mark|send-wrap\[data-running\]|split-handle|floating-grip|floating-corner|attach-img|composer textarea/.test(sel);
        for (const m of body.matchAll(/(?<![-\w])(font-size|line-height|(?:min-|max-)?(?:width|height))\s*:\s*([^;]+)/g))
            if (!sizeOk && /\d(px|rem)\b/.test(m[2]!) && !/^[012]px$/.test(m[2]!.trim())) bad.push(`${sel}: ${m[1]} ${m[2]!.trim()} — use a named token`);
        // motion and layers: durations and z-index by token only
        for (const m of body.matchAll(/(?<![-\w])(transition|animation|z-index)\s*:\s*([^;]+)/g))
            if (/(^|\s)-?\d*\.?\d+m?s\b|^\d+$/.test(m[2]!.trim())) bad.push(`${sel}: ${m[1]} ${m[2]!.trim()} — use --w-motion-* / --w-layer-*`);
        // lines (principle 13): the one rule by token; 2px only through --w-focus-width; one caps spacing
        if (!/markdown|floating-corner|kbd/.test(sel)) for (const m of body.matchAll(/(?<![-\w])(border(?:-top|-bottom|-left|-right|-inline-start|-inline-end)?|outline)\s*:\s*([^;]+)/g))
            if (/\d+px solid/.test(m[2]!) && !/^1px solid transparent$/.test(m[2]!.trim())) bad.push(`${sel}: ${m[1]} ${m[2]!.trim()} — use --w-rule / --w-focus-width`);
        for (const m of body.matchAll(/letter-spacing:\s*([^;]+)/g)) if (m[1]!.trim() !== "var(--w-caps-spacing)") bad.push(`${sel}: letter-spacing ${m[1]}`);
        if (/:hover/.test(sel) && !/w-link|markdown a/.test(sel) && /--w-(selected|link|focus|blue)/.test(body)) bad.push(`${sel}: blue hover`);
    }
    expect(bad).toEqual([]);
});

test("states: disabled is one opacity everywhere, empty and error share w.empty, an empty list draws it", async () => {
    const ctx: any = await mkTestCtx();
    expect(ctx.fns.w.iconButton({ icon: "trash", label: "Delete", disabled: true, action: { action: "x" } })).toContain(" disabled");
    expect(ctx.fns.w.list({ body: "", empty: "No chats" })).toContain('class="w-empty"');
    const err = ctx.fns.w.empty({ title: "Failed", tone: "danger" });
    expect(err).toContain('role="alert"');
    const css = await Bun.file(new URL("./$style_w.css", import.meta.url)).text();
    expect([...css.matchAll(/[^{}]*disabled[^{}]*\{([^}]*)\}/g)].filter(m => /opacity/.test(m[1]!) && !/var\(--w-disabled-opacity\)/.test(m[1]!)).length).toBe(0);
});

test("colours are meanings only: no numbered scale, every colour defined is used by a widget", async () => {
    const css = await Bun.file(new URL("./$style_w.css", import.meta.url)).text();
    const cut = css.indexOf("/* sizes and type");
    const colours = [...new Set([...css.slice(0, cut).matchAll(/(--w-[a-z-]+):\s*#/g)].map(m => m[1]!))];
    const rules = css.slice(cut);
    expect(colours.length).toBeLessThanOrEqual(19);
    expect([...css.matchAll(/--w-(grey|blue)-\d+/g)].map(m => m[0])).toEqual([]);
    expect(colours.filter(c => !rules.includes(`var(${c})`))).toEqual([]);
});

test("no two files differ only by letter case (macOS would write one over the other)", async () => {
    const { readdirSync } = await import("node:fs");
    const names = readdirSync(new URL(".", import.meta.url)).map(n => n.replace(/\.[^.]+$/, ""));
    const seen = new Map<string, string>(); const clash: string[] = [];
    for (const n of names) { const k = n.toLowerCase(); if (seen.has(k) && seen.get(k) !== n) clash.push(`${seen.get(k)} / ${n}`); seen.set(k, n); }
    expect(clash).toEqual([]);
});

test("button: submit and automation marks", async () => {
    const ctx: any = await mkTestCtx();
    const s = ctx.fns.w.button({ label: "Save", tone: "primary", submit: { name: "op", value: "save" }, marks: { action: "save-node" } });
    expect(s).toContain('type="submit"');
    expect(s).toContain('name="op" value="save"');
    expect(s).toContain('data-action="save-node"');
    expect(s).not.toContain("hx-");
    expect(() => ctx.fns.w.button({ label: "x", submit: true, action: { href: "/" } })).toThrow();
    const i = ctx.fns.w.iconButton({ icon: "x", label: "Close", marks: { action: "close", id: "a1" } });
    expect(i).toContain('data-action="close" data-id="a1"');
});
