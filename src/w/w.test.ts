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

test("avatar: online is a mark the theme draws, not a different size", async () => {
    const ctx: any = await mkTestCtx();
    const on = await ctx.fns.w.avatar({ name: "Roman Pogorov", size: 24, online: true });
    const off = await ctx.fns.w.avatar({ name: "Roman Pogorov", size: 24 });
    expect(on).toContain("data-online");
    expect(off).not.toContain("data-online");
    expect(on).toContain('data-size="24"');
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

test("page-level widgets: page, field, form, record carry the automation markers", async () => {
    const ctx: any = await mkTestCtx();
    const w = ctx.fns.w;
    expect(w.escape({ text: `<a "x">` })).toBe("&lt;a &quot;x&quot;&gt;");
    expect(w.marks({ entity: "x", id: 3, gone: "" })).toBe('data-entity="x" data-id="3"');
    expect(w.page({ page: "modules", title: "Plugins", body: "B" })).toContain('data-page="modules"');
    const input = w.input({ name: "q", value: "", invalid: true, describedBy: "q-err" });
    expect(input).toContain('data-field="q"'); expect(input).toContain('value=""'); expect(input).toContain('aria-invalid="true"');
    const field = w.field({ name: "q", label: "Query", control: input, error: "Too short" });
    expect(field).toContain('data-invalid="true"'); expect(field).toContain('data-role="error"');
    expect(() => w.form({ form: "f", body: "" })).toThrow();
    expect(w.form({ form: "f", post: "/x", body: "" })).toContain('data-form="f"');
    const rec = w.record({ entity: "llm-account", id: "a/b", status: "ready", cells: [{ role: "plan", text: "Max" }], end: "E" });
    expect(rec).toContain('data-entity="llm-account"'); expect(rec).toContain('data-role="plan"');
    expect(w.segmented({ items: [] })).toBe("");
    expect(w.segmented({ value: "b", items: [{ label: "A", value: "a", action: { href: "/x?a" } }, { label: "B", value: "b", action: { href: "/x?b" } }] })).toContain('aria-current="true"');
    expect(w.crumbs({ items: [{ label: "News", href: "/news" }, { label: "Here" }] })).toContain('aria-current="page"');
    expect(w.sparkline({ values: [1, 3, 2] })).toContain("<path");
    expect(w.stats({ items: [{ label: "Runs", value: 3, tone: "danger" }] })).toContain('data-tone="danger"');
    const res = w.respond({ html: "ok", toast: { message: "Сохранено" } });
    expect(res.headers.get("HX-Trigger")).toContain("\\u0421");
});

test("pressable and hooks: behaviour hooks pass, visual attributes are refused", async () => {
    const ctx: any = await mkTestCtx();
    const w = ctx.fns.w;
    const p = w.pressable({ html: "<i></i>", label: "Pin", marks: { action: "toggle-dock-pin" }, attrs: { "data-dock-pin-toggle": "", onclick: "x()" }, class: "dock-btn" });
    expect(p).toContain('data-action="toggle-dock-pin"'); expect(p).toContain('data-dock-pin-toggle=""'); expect(p).toContain('aria-label="Pin"');
    expect(() => w.hooks({ attrs: { style: "color:red" } })).toThrow();
    expect(w.hooks({ attrs: { "anchor-name": "--x" } })).toBe(' style="anchor-name:--x"');
    expect(w.iconButton({ icon: "trash", label: "Delete", submit: { name: "action", value: "delete" } })).toContain('type="submit" name="action" value="delete"');
    expect(w.button({ label: "Save", submit: true, wide: true })).toContain("data-wide");
});

test("dialog, dialogOpener, textarea and page aside: native dialog form, escaped, opener points at it", async () => {
    const ctx: any = await mkTestCtx();
    const w = ctx.fns.w;
    const d = w.dialog({ id: "new task", title: "<New>", post: "/tasks", submitLabel: "Create", body: w.textarea({ name: "description", value: "<b>", rows: 99, required: true }) });
    expect(d).toContain('<dialog id="new-task" class="w-dialog"');
    expect(d).toContain("&lt;New&gt;");
    expect(d).toContain('hx-post="/tasks"'); expect(d).toContain("data-dialog-form");
    expect(d).toContain('data-dialog-close=""'); expect(d).toContain('type="submit"');
    expect(d).toContain('rows="40" required>&lt;b&gt;</textarea>');
    expect(w.dialogOpener({ dialog: "new task", label: "New" })).toContain('data-dialog-open="new-task"');
    const page = w.page({ page: "task", title: "T", body: "<p>main</p>", aside: "<p>side</p>", crumbs: w.crumbs({ items: [{ label: "Tasks", href: "/tasks" }, { label: "T" }] }) });
    expect(page).toContain('<aside class="w-page-aside"><p>side</p></aside>');
    expect(page.indexOf("w-crumbs")).toBeLessThan(page.indexOf("w-page-title"));
});

test("menu widgets: palette starts hidden, rows keep hooks and put the pin outside the link, tiles carry size", async () => {
    const ctx: any = await mkTestCtx();
    const w = ctx.fns.w;
    const pal = w.palette({ id: "nav-overlay", label: "Global menu", head: w.search({ url: "/nav/items", target: "#nav-results", id: "nav-q", include: "#nav-tab", trigger: "input changed delay:250ms", variant: "bar", keys: "esc" }), bodyId: "nav-results", hints: [{ keys: "↵", label: "open" }] });
    expect(pal).toContain('id="nav-overlay" hidden');
    expect(pal).toContain('id="nav-q" hx-include="#nav-tab" hx-sync="this:replace"');
    expect(pal).toContain('hx-trigger="input changed delay:250ms"');
    expect(pal).toContain('id="nav-results"');
    const row = w.listRow({ label: "<x>", meta: "(da)", action: { href: "/agent/da" }, attrs: { "data-nav-row": true, "data-nav-id": "agent:da" }, end: w.iconButton({ icon: "push-pin", label: "Pin", submit: true }) });
    expect(row).toMatch(/^<div class="w-row-wrap"><a class="w-row"[^>]*data-nav-row data-nav-id="agent:da"/);
    expect(row.indexOf("</a>")).toBeLessThan(row.indexOf("<button"));
    expect(row).toContain("&lt;x&gt;");
    expect(() => w.listRow({ label: "x", attrs: { class: "evil" } })).toThrow();
    expect(w.tile({ title: "Chats", size: "wide", body: "" })).toContain('data-size="wide"');
    expect(w.listSection({ title: "Pinned", tone: "warning", rows: "" })).toContain('data-tone="warning"');
    expect(w.tabs({ variant: "underline", items: [{ id: "a", label: "A", attrs: { "data-nav-tab": "a" } }], end: "E" })).toContain('<span class="w-tabs-end">E</span>');
});

test("rail: hooks on the bar and its areas, railItem toggles carry aria-pressed and refuse visual attributes", async () => {
    const ctx: any = await mkTestCtx();
    const w = ctx.fns.w;
    const item = w.railItem({ label: "Panel", icon: "sidebar-simple", pressed: false, action: { action: "toggle-dock-panel" }, attrs: { "data-dock-id": "panel", "data-dock-fixed": true } });
    expect(item).toContain('aria-pressed="false"'); expect(item).toContain('data-action="toggle-dock-panel"'); expect(item).toContain("data-dock-fixed");
    expect(w.railItem({ label: "x" })).not.toContain("aria-pressed");
    expect(() => w.railItem({ label: "x", attrs: { class: "y" } })).toThrow();
    const rail = w.rail({ label: "Dock", attrs: { id: "dock" }, itemsAttrs: { "data-zone": "top" }, footAttrs: { "data-zone": "bottom" }, items: item });
    expect(rail).toContain('<nav class="w-rail" aria-label="Dock" id="dock">'); expect(rail).toContain('class="w-rail-items" data-zone="top"'); expect(rail).toContain('class="w-rail-foot" data-zone="bottom"');
});

test("chatIcon: the model logo or the chat's own icon, a turning ring while it runs, live ring hidden until the header runs", async () => {
    const ctx: any = await mkTestCtx();
    const idle = ctx.fns.w.chatIcon({ model: "anthropic:claude-opus-4-5" });
    expect(idle).toContain('class="w-chat-icon" data-size="sm"');
    expect(idle).not.toContain("w-chat-icon-ring");
    expect(ctx.fns.w.chatIcon({ model: "x", active: true })).toContain('aria-label="running"');
    expect(ctx.fns.w.chatIcon({ model: "x", live: true, size: "md" })).toContain('class="w-chat-icon-ring" data-live');
    const line = ctx.fns.w.chatIcon({ icon: '<svg viewBox="0 0 8 8" stroke="currentColor"><path d="M0 0"/></svg>' });
    expect(line).toContain('data-kind="line"');
    expect(line).toContain("<svg aria-hidden");
    const pic = ctx.fns.w.chatIcon({ icon: '<svg viewBox="0 0 8 8"><rect width="8" height="8" fill="red"/></svg>', size: "lg" });
    expect(pic).toContain('<img src="data:image/svg+xml,');
    expect(pic).not.toContain("size-");
});
