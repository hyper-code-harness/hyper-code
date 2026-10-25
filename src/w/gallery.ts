/**
 * Shows the Hyper widget set — tokens, atoms, molecules, organisms, templates — on one page.
 *
 * The catalogue of the w.* widgets by atomic design level, each drawn by its own function with realistic props (this chat's agent, real people). Open it on the canvas (/rpc/w.gallery) to pick a widget before writing markup, and to check a token, theme or widget change everywhere at once. A widget that throws shows its error in its cell.
 * @view
 * @param opts.agentId Agent whose icon and rows fill the agent samples; defaults to the current agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose icon and rows fill the agent samples; defaults to the current agent. */
        agentId?: string;
    },
): Promise<string> {
    const w: any = (ctx.fns as any).w;
        const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
        const safe = async (name: string, f: () => any): Promise<string> => { try { return String(await f()); } catch (e: any) { return `<span style="color:var(--w-danger);font-size:12px">${esc(name)}: ${esc(e?.message ?? e)}</span>`; } };
        const me = String(opts.agentId ?? (await ctx.fns.agent.current({}).catch(() => ({ id: "" })) as any).id ?? "");
        const now = Date.now();
        const swatch = (v: string, label: string) => `<div class="wg-swatch"><span style="background:var(${v})"></span><code>${v}</code><small>${label}</small></div>`;
        const tokens = [
            ["--w-surface-chrome", "bars, headers"], ["--w-surface-chat", "conversation"], ["--w-surface-document", "pages, cards"], ["--w-fg", "text"], ["--w-fg-muted", "secondary"], ["--w-fg-faint", "quiet"],
            ["--w-border", "lines"], ["--w-accent", "main action"], ["--w-info", "running, links"], ["--w-success", "done"], ["--w-warning", "attention"], ["--w-danger", "errors"],
        ].map(([v, l]) => swatch(v!, l!)).join("");
        const groups: Array<[string, string, Array<[string, () => any]>]> = [
            ["Atoms", "indivisible pieces", [
                ["icon", () => ["gear-six", "folder", "terminal", "check-circle", "warning"].map(n => w.icon({ name: n, size: 20 })).join(" ") + " " + w.icon({ name: "warning", size: 20, tone: "warning" }) + " " + w.icon({ name: "x-circle", size: 20, tone: "danger" })],
                ["button", () => [w.button({ label: "Default" }), w.button({ label: "Accent", tone: "accent" }), w.button({ label: "Danger", tone: "danger", icon: "trash" }), w.button({ label: "Ghost", tone: "ghost" }), w.button({ label: "Small", size: "sm" }), w.button({ label: "Disabled", disabled: true })].join(" ")],
                ["badge", () => ["neutral", "info", "success", "warning", "danger", "accent"].map(t => w.badge({ text: t, tone: t })).join(" ")],
                ["dot", () => ["idle", "running", "unread", "warning", "error"].map(s => w.dot({ state: s, label: s })).join(" &nbsp; ")],
                ["kbd", () => [w.kbd({ keys: "⌘B" }), w.kbd({ keys: "⌘⇧P" }), w.kbd({ keys: "Ctrl+\\" })].join(" ")],
                ["time", () => [w.time({ ts: now - 60000 }), w.time({ ts: now - 3600e3, format: "ago" }), w.time({ ts: now - 5 * 86400e3, format: "date" })].join(" · ")],
                ["avatar", async () => [await w.avatar({ name: "Nikolai Ryzhikov", size: 32 }), await w.avatar({ name: "Roman Pogorov", size: 24 }), me ? await w.avatar({ agentId: me, size: 32 }) : "", await w.avatar({ name: "?", size: 20 })].join(" ")],
                ["divider", () => w.divider({}) + w.divider({ label: "stopped by user" })],
                ["spinner", () => [w.spinner({ kind: "arc" }), w.spinner({ kind: "arc", size: 20 }), w.spinner({ kind: "glow", html: w.icon({ name: "terminal", size: 16 }) })].join(" ") + w.spinner({ kind: "skeleton", lines: 2 })],
                ["ring", () => [w.ring({ value: 30, label: "30%" }), w.ring({ value: 75, label: "75%" }), w.ring({ value: 95, label: "95%" }), w.ring({ value: 2, max: 5, tone: "accent", label: "2/5" })].join(" ")],
                ["colorInput", () => w.colorInput({ name: "accent", value: "#2563eb", label: "Accent" })],
            ]],
            ["Molecules", "atoms combined for one job", [
                ["iconButton", () => [w.iconButton({ icon: "magnifying-glass", label: "Search" }), w.iconButton({ icon: "pencil-simple", label: "Edit" }), w.iconButton({ icon: "sidebar-simple", label: "Panel", pressed: true }), w.iconButton({ icon: "bell", label: "Mentions", badge: 3 }), w.iconButton({ icon: "x", label: "Close", size: 24 })].join(" ")],
                ["listRow", () => w.list({ body: [w.listRow({ label: "UI layouts: canvas, chat, voice", icon: "squares-four", hint: "hyper-design", dot: "running", current: true }), w.listRow({ label: "Оливия", icon: "sparkle", hint: "at", dot: "unread" }), w.listRow({ label: "notes/ui-layouts.md", detail: "project memory · 2 h ago", icon: "file-text" }), w.listRow({ label: "Delete chat", icon: "trash", tone: "danger" })].join("") })],
                ["tooltip", () => w.tooltip({ label: "Collapse the bar — ⌘B", html: w.iconButton({ icon: "push-pin", label: "Pin", action: { action: "pin" } }) })],
                ["search", () => w.search({ url: "/nav/items", target: "#wg-search-out", placeholder: "Search chats…" }) + '<div id="wg-search-out"></div>'],
                ["toast", () => w.toast({ message: "Pushed to main", level: "success", body: "a8d89626 — chat header: the icon opens the panel" }) + "<div style='height:6px'></div>" + w.toast({ message: "Could not save the Dock", level: "error", action: { label: "Retry", action: "retry" } })],
                ["keyValue", () => w.keyValue({ items: [{ key: "Model", value: "opus-5.5" }, { key: "Project", value: "hyper-design" }, { key: "Started", html: w.time({ ts: now - 7200e3, format: "ago" }) }] })],
                ["eventNote", () => [w.eventNote({ text: "stopped by user", icon: "stop-circle" }), w.eventNote({ text: "Context compacted · 636k → 2k", icon: "arrows-in-line-vertical", details: "<p>10 messages kept.</p>", ts: now - 600e3 })].join("")],
                ["thinking", () => w.thinking({ text: "The header and the tabs use different greys; unify them on base-200…", seconds: 12 })],
                ["fileRef", () => w.list({ body: w.fileRef({ path: "/Users/hyper-design/hyper-code2/src/ui/layout.ts" }) + w.fileRef({ path: "docs/canvas-views.md" }) })],
                ["jobRow", () => w.list({ body: w.jobRow({ title: "bun test src/canvas", status: "running", startedAt: now - 30000 }) + w.jobRow({ title: "deploy", status: "failed" }) })],
                ["personChip", async () => (await w.personChip({ userId: "niquola" })) + " " + (await w.personChip({ userId: "roman.pogorov" }))],
                ["railItem", () => [w.railItem({ label: "Hyper", icon: "squares-four" }), w.railItem({ label: "Panel", icon: "sidebar-simple", current: true }), w.railItem({ label: "Mentions", icon: "at", badge: 2 }), w.railItem({ label: "Оливия", icon: "sparkle", dot: "unread" })].join(" ")],
            ]],
            ["Organisms", "sections of the interface", [
                ["paneHeader", () => w.paneHeader({ lead: w.iconButton({ icon: "squares-four", label: "Chat panel" }), title: "UI layouts: canvas, chat, voice", meta: "(da)", actions: w.iconButton({ icon: "folder-open", label: "Files" }) + w.iconButton({ icon: "dots-three", label: "More" }) })],
                ["tabs (equal)", () => w.paneHeader({ center: w.tabs({ items: [{ id: "a", label: "Темы оформления", icon: "browser", close: { action: "close" } }, { id: "b", label: "UI components", icon: "browser" }, { id: "c", label: "Раскладки", icon: "browser" }], active: "a" }), actions: w.iconButton({ icon: "arrows-out-simple", label: "Canvas on the whole page" }) + w.iconButton({ icon: "x", label: "Close canvas" }) })],
                ["tabs (underline)", () => w.tabs({ variant: "underline", items: [{ id: "o", label: "Overview" }, { id: "s", label: "Settings", count: 3 }, { id: "l", label: "Logs" }], active: "o" })],
                ["addressBar", () => w.addressBar({ url: "/rpc/memory.view?{\"key\":\"notes/ui-layouts.md\"}", back: { action: "back" } })],
                ["toolbar", () => w.toolbar({ start: w.button({ label: "Back", icon: "arrow-left", tone: "ghost", size: "sm" }), end: w.button({ label: "Save", tone: "accent", size: "sm" }) })],
                ["listSection", () => w.list({ body: w.listSection({ title: "hyper-design", count: 3, actions: w.iconButton({ icon: "plus", label: "New chat", size: 24 }), rows: w.listRow({ label: "UI layouts", icon: "squares-four", dot: "running" }) + w.listRow({ label: "Performance", icon: "gauge" }) }) + w.listSection({ title: "No project", collapsed: true, rows: w.listRow({ label: "jobs-smoke", icon: "timer" }) }) })],
                ["menu", () => w.menu({ id: "wg-menu", label: "Message actions", trigger: w.button({ label: "Open menu", icon: "dots-three", size: "sm", action: { popover: "wg-menu" } }), items: [{ label: "Copy text", icon: "copy", keys: "⌘C" }, { label: "Open in canvas", icon: "square-half" }, "-", { label: "Delete message", icon: "trash", danger: true }, { label: "Delete from here", icon: "arrow-line-down", danger: true }] })],
                ["popover", () => w.popover({ id: "wg-pop", label: "Settings", trigger: w.button({ label: "Open popover", icon: "gear-six", size: "sm", action: { popover: "wg-pop" } }), body: w.list({ body: w.listRow({ label: "Theme", icon: "moon", hint: "Light" }) + w.listRow({ label: "Hyper update", icon: "arrows-clockwise", hint: "up to date" }) }), width: 240 })],
                ["confirm", () => `<button class="w-btn" data-tone="danger" data-size="sm" popovertarget="wg-confirm">Delete chat…</button>` + w.confirm({ id: "wg-confirm", title: "Delete this chat?", text: "Messages, canvas tabs and memory of this agent are removed.", confirmLabel: "Delete", danger: true, action: { action: "delete" } })],
                ["card", () => w.card({ title: "Context", icon: "stack", body: w.list({ body: w.listRow({ label: "Last request", icon: "gauge", hint: "636k tokens" }) + w.listRow({ label: "Compact context…", icon: "arrows-in-line-vertical", hint: "100% used" }) }) }) + "<div style='height:8px'></div>" + w.card({ title: "Danger zone", icon: "warning", tone: "danger", body: w.list({ body: w.listRow({ label: "Delete", icon: "trash", tone: "danger" }) }) })],
                ["message", async () => [w.message({ role: "user", author: "Nikolai Ryzhikov", html: "давай сделаем как в chatgpt", ts: now - 120e3, avatar: await w.avatar({ name: "Nikolai Ryzhikov", size: 24 }) }), w.message({ role: "agent", html: "<p>Сделал: ответы теперь прямо на фоне, без пузыря.</p>", ts: now - 60e3 }), w.message({ role: "peer", author: "Оливия", html: "Опубликовала в Telegram.", avatar: me ? await w.avatar({ agentId: "at", size: 24 }) : "" })].join("<div style='height:10px'></div>")],
                ["toolGroup", () => w.toolGroup({ calls: [{ icon: "terminal", title: "bash git status" }, { icon: "brackets-curly", title: "eval" }, { icon: "pencil-simple", title: "edit layout.ts" }, { icon: "terminal", title: "bun test", error: true }, { icon: "brackets-curly", title: "eval", running: true }], runningSince: now - 12000 }) + "<div style='height:8px'></div>" + w.toolGroup({ calls: Array.from({ length: 9 }, (_, i) => ({ icon: i % 2 ? "terminal" : "brackets-curly", title: "call " + i, error: i === 4 })) })],
                ["composer", () => w.composer({ post: "#", tools: `${w.icon({ name: "sparkle", size: 14 })} Opus 5.5 · Auto` }) + "<div style='height:8px'></div>" + w.composer({ post: "#", running: true }) + "<div style='height:8px'></div>" + w.composer({ post: "#", compact: true })],
                ["planView", () => w.planView({ title: "Hyper widget set", tasks: [{ title: "Tokens + stylesheet", status: "done" }, { title: "Base widgets", status: "done" }, { title: "Gallery on canvas", status: "active" }, { title: "Move the chat onto widgets", status: "pending" }] })],
                ["agentRow", async () => me ? w.list({ body: (await w.agentRow({ agentId: me })) + (await w.agentRow({ agentId: "at" })) }) + "<div style='height:8px'></div>" + (await w.agentRow({ agentId: me, variant: "card" })) : ""],
                ["rail", () => `<div style="height:180px;display:flex">${w.rail({ head: w.railItem({ label: "Hyper", icon: "squares-four" }), items: w.railItem({ label: "Panel", icon: "sidebar-simple", current: true }) + w.railItem({ label: "Оливия", icon: "sparkle", dot: "unread" }) + w.railItem({ label: "Mentions", icon: "at", badge: 2 }), foot: w.railItem({ label: "Settings", icon: "gear-six" }) })}</div>`],
            ]],
            ["Templates", "page skeletons that place organisms", [
                ["pane", () => `<div style="height:200px;border:1px solid var(--w-border)">${w.pane({ surface: "chat", header: w.paneHeader({ title: "Chat", meta: "(da)", actions: w.iconButton({ icon: "dots-three", label: "More" }) }), body: `<div style="padding:12px">${w.message({ role: "agent", html: "<p>A pane: header, scrolling body, footer.</p>" })}</div>`, footer: w.composer({ post: "#", compact: true }) })}</div>`],
                ["split", () => `<div style="height:160px;border:1px solid var(--w-border)">${w.split({ size: 200, min: 120, start: w.pane({ header: w.paneHeader({ title: "Canvas" }), body: "<div style='padding:12px'>document</div>" }), end: w.pane({ surface: "chat", header: w.paneHeader({ title: "Chat" }), body: "<div style='padding:12px'>conversation</div>" }) })}</div>`],
                ["floating", () => `<div style="position:relative;height:150px;background:var(--w-surface-document);border:1px solid var(--w-border);padding:12px">${w.floating({ body: `<div style="padding:14px 12px 0">${w.message({ role: "agent", html: "<p>The folded chat: only the latest message.</p>" })}</div>` + w.composer({ post: "#", compact: true }) })}</div>`],
            ]],
        ];
        const sections = await Promise.all(groups.map(async ([title, sub, items]) => {
            const cells = await Promise.all(items.map(async ([name, f]) => `<div class="wg-cell"><div class="wg-name"><code>w.${esc(name.split(" ")[0])}</code>${name.includes(" ") ? ` <small>${esc(name.split(" ").slice(1).join(" "))}</small>` : ""}</div><div class="wg-sample">${await safe(name, f)}</div></div>`));
            return `<section><h2>${esc(title)} <small>${esc(sub)}</small></h2><div class="wg-grid" data-level="${esc(title.toLowerCase())}">${cells.join("")}</div></section>`;
        }));
        const style = `<style>
    .wg{max-width:76rem;margin:0 auto;padding:1.25rem 1.5rem 3rem;font-size:13px;color:var(--w-fg)}
    .wg h1{font-size:20px;font-weight:600;margin:0}.wg>p{color:var(--w-fg-muted);margin:.25rem 0 1rem}
    .wg h2{font-size:15px;font-weight:600;margin:1.5rem 0 .5rem}.wg h2 small{font-weight:400;color:var(--w-fg-faint);font-size:12px}
    .wg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));gap:1px;background:var(--w-border);border:1px solid var(--w-border);border-radius:.5rem}
    .wg-grid[data-level="organisms"],.wg-grid[data-level="templates"]{grid-template-columns:repeat(auto-fill,minmax(30rem,1fr))}
    .wg-cell{background:var(--w-surface-document);padding:.75rem .875rem;min-width:0}
    .wg-name{margin-bottom:.5rem}.wg-name code{font-size:11px;color:var(--w-fg-muted)}.wg-name small{font-size:11px;color:var(--w-fg-faint)}
    .wg-sample{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem;min-width:0}.wg-sample>*{max-width:100%}.wg-sample>:is(.w-list,.w-card,.w-msg,.w-composer,.w-tool-row,.w-skeleton,div:not([popover])){width:100%}
    .wg-tokens{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem}
    .wg-swatch{display:grid;grid-template-columns:1.75rem 1fr;grid-template-rows:auto auto;column-gap:.5rem;align-items:center}
    .wg-swatch span{grid-row:span 2;width:1.75rem;height:1.75rem;border-radius:.375rem;border:1px solid var(--w-border)}.wg-swatch code{font-size:11px}.wg-swatch small{font-size:11px;color:var(--w-fg-faint)}
    </style>`;
        return `${style}<div class="wg"><h1>Hyper widgets</h1><p>The widget set by atomic design: tokens → atoms → molecules → organisms → templates. Each widget is a server function <code>w.&lt;name&gt;</code>; styles live in one stylesheet (<code>src/w/$style_w.css</code>), one cascade layer per level, and read only the tokens below — change a token and every widget follows.</p><section><h2>Tokens <small>the only thing a theme sets</small></h2><div class="wg-tokens">${tokens}</div></section>${sections.join("")}</div>`;
}
