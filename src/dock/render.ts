/**
 * Renders the left Dock: the fixed global-menu button on top, the top zone, the bottom zone, and the
 * signed-in person at the very bottom.
 *
 * Every `$dock_` entry is drawn in parallel with its own timeout; an entry that throws, times out or
 * returns nothing is simply left out, so one plugin cannot break or stall the page shell. Each entry is
 * wrapped in an element carrying `data-dock-id` for ordering and automation.
 * @param opts.timeoutMs Per-entry render budget in milliseconds. @default 1500 @minimum 50 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Per-entry render budget in milliseconds. @default 1500 @minimum 50 @maximum 10000 */
        timeoutMs?: number;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const budget = Math.max(50, Math.min(10_000, opts.timeoutMs ?? 1500));
    const { top, bottom, hidden } = await ctx.fns.dock.items({});
    const labels = Object.fromEntries([...top, ...bottom, ...hidden].map(x => [x.id, x.label ?? x.id]));
    const draw = async (item: types.dock.Registered, fixed = false): Promise<string> => {
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const out = await Promise.race([
                Promise.resolve(item.render ? item.render(ctx, session) : { icon: item.icon ?? "ph-circle", label: item.label ?? item.id, href: item.href }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget); }),
            ]).finally(() => clearTimeout(timer));
            if (!out) return "";
            const html = typeof out === "string" ? out : await ctx.fns.dock.drawButton({ id: item.id, button: out });
            return html ? `<div class="dock-item" data-dock-id="${esc(item.id)}"${fixed ? " data-dock-fixed" : ""}${item.pinned ? ` data-dock-pinned="${item.pinned}"` : ""} data-dock-label="${esc(item.label ?? item.id)}">${html}</div>` : "";
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "dock.render.failed", msg: `${item.id}: ${String(error?.message ?? error)}` });
            return "";
        }
    };
    // People and the gear are not sections to reorder: who is online sits right above the person, the gear under
    // them, whatever zone an older saved layout gives them; both are fixed (no context menu).
    const online = [...top, ...bottom].find(x => x.id === "auth.online");
    const gear = [...top, ...bottom].find(x => x.id === "settings");
    const movable = (x: types.dock.Registered) => x !== gear && x !== online;
    const [topHtml, bottomHtml, onlineHtml, me, gearHtml] = await Promise.all([
        Promise.all(top.filter(movable).map(x => draw(x))),
        Promise.all(bottom.filter(movable).map(x => draw(x))),
        online ? draw(online, true) : Promise.resolve(""),
        ctx.fns.auth.meBadge({}).catch(() => ""),
        gear ? draw(gear, true) : Promise.resolve(""),
    ]);
    const w = ctx.fns.w;
    // The three fixed buttons carry data-dock-fixed (no context menu); their clicks are named actions /dock/dock.js handles.
    const menu = w.railItem({ label: "Global menu — ⌘/", icon: "squares-four", action: { action: "open-global-menu" }, attrs: { "data-dock-id": "menu", "data-dock-fixed": true, "data-dock-label": "Hyper" } });
    // Keeps the bar or folds it into the menu circle (it then unfolds on hover); both icons are drawn, CSS shows the one for the mode.
    const pinToggle = w.railItem({ label: "Collapse the bar into the circle", face: `<span class="dock-pin-off">${w.icon({ name: "push-pin-slash" })}</span><span class="dock-pin-on">${w.icon({ name: "push-pin" })}</span>`, action: { action: "toggle-dock-pin" }, attrs: { "data-dock-id": "pin", "data-dock-fixed": true } });
    // Opens and closes the projects-and-chats panel beside the Dock (menu mode); aria-pressed follows the mode.
    const panelToggle = w.railItem({ label: "Projects and chats — ⌘B", icon: "sidebar-simple", pressed: false, action: { action: "toggle-dock-panel" }, attrs: { "data-dock-id": "panel", "data-dock-fixed": true } });
    const zoneTop = `<div id="dock-top" class="dock-zone" data-dock-zone="top">${topHtml.join("")}</div>`;
    const zoneBottom = `<div id="dock-bottom" class="dock-zone" data-dock-zone="bottom">${bottomHtml.join("")}</div>`;
    return w.rail({
        label: "Dock",
        attrs: { id: "dock", "data-dock-hidden": JSON.stringify(hidden.map(x => x.id)), "data-dock-labels": JSON.stringify(labels) },
        head: menu,
        items: pinToggle + panelToggle + zoneTop,
        foot: zoneBottom + onlineHtml + (me ? `<div class="dock-me" data-dock-id="me" data-dock-fixed data-dock-label="Account">${me}</div>` : "") + gearHtml,
    }) + `<script src="/dock/dock.js?v=4" defer></script>`;
}
