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
    const draw = async (item: types.dock.Registered): Promise<string> => {
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const out = await Promise.race([
                Promise.resolve(item.render ? item.render(ctx, session) : { icon: item.icon ?? "ph-circle", label: item.label ?? item.id, href: item.href }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget); }),
            ]).finally(() => clearTimeout(timer));
            if (!out) return "";
            const html = typeof out === "string" ? out : await ctx.fns.dock.drawButton({ id: item.id, button: out });
            return html ? `<div class="dock-item flex w-full flex-col items-center" data-dock-id="${esc(item.id)}"${item.pinned ? ` data-dock-pinned="${item.pinned}"` : ""} data-dock-label="${esc(item.label ?? item.id)}">${html}</div>` : "";
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "dock.render.failed", msg: `${item.id}: ${String(error?.message ?? error)}` });
            return "";
        }
    };
    // The settings gear is drawn last, under the person, whatever zone the layout gives it.
    const gear = [...top, ...bottom].find(x => x.id === "settings");
    const [topHtml, bottomHtml, me, gearHtml] = await Promise.all([
        Promise.all(top.filter(x => x !== gear).map(draw)),
        Promise.all(bottom.filter(x => x !== gear).map(draw)),
        ctx.fns.auth.meBadge({}).catch(() => ""),
        gear ? draw(gear) : Promise.resolve(""),
    ]);
    const menu = ctx.fns.procs.ui.button({ action: "open-global-menu", html: '<i class="ph ph-squares-four text-base" aria-hidden="true"></i>', appearance: "plain", title: "Global menu — ⌘/", ariaLabel: "Open global menu", class: "flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content", attrs: { onclick: "window.__navOpen?.()" } });
    // Opens and closes the projects-and-chats panel beside the Dock (menu mode); /dock/dock.js handles the click.
    const panelToggle = ctx.fns.procs.ui.button({ action: "toggle-dock-panel", html: '<i class="ph ph-sidebar-simple text-base" aria-hidden="true"></i>', appearance: "plain", title: "Projects and chats — ⌘B", ariaLabel: "Projects and chats", class: "flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content", attrs: { "data-dock-panel-toggle": "" } });
    // Keeps the bar or folds it into the menu circle (it then unfolds on hover); /dock/dock.js handles the click.
    const pinToggle = ctx.fns.procs.ui.button({ action: "toggle-dock-pin", html: '<i class="ph ph-push-pin-slash text-base dock-pin-off" aria-hidden="true"></i><i class="ph ph-push-pin text-base dock-pin-on" aria-hidden="true"></i>', appearance: "plain", title: "Collapse the bar into the circle", ariaLabel: "Collapse or pin the bar", class: "flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content", attrs: { "data-dock-pin-toggle": "" } });
    return `<nav id="dock" aria-label="Dock" data-dock-hidden="${esc(JSON.stringify(hidden.map(x => x.id)))}" data-dock-labels="${esc(JSON.stringify(labels))}" class="my-2 ml-2 mr-1 flex h-[calc(100%-1rem)] w-10 shrink-0 flex-col items-center rounded-2xl border border-ui-border py-2 shadow-sm">
    <div class="dock-fixed flex w-full flex-col items-center" data-dock-id="menu" data-dock-label="Hyper">${menu}</div>
    <div class="dock-fixed mt-1 flex w-full flex-col items-center" data-dock-id="pin">${pinToggle}</div>
    <div class="dock-fixed flex w-full flex-col items-center" data-dock-id="panel">${panelToggle}</div>
    <div id="dock-top" class="dock-zone mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto" data-dock-zone="top">${topHtml.join("")}</div>
    <div id="dock-bottom" class="dock-zone flex w-full flex-col items-center gap-1" data-dock-zone="bottom">${bottomHtml.join("")}</div>
    ${me ? `<div class="dock-fixed mt-1 flex w-full flex-col items-center" data-dock-id="me" data-dock-label="Account">${me}</div>` : ""}
    ${gearHtml}
    <script src="/dock/dock.js?v=2" defer></script>
  </nav>`;
}
