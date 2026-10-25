/**
 * Draws menu rows (types.nav.Item) the way the global menu (⌘/) shows them everywhere — in widgets and in
 * search results — as keyboard-navigable `.nav-row` links with an icon or model logo, hint, unread dot and a
 * hover 📌 toggle for rows that can be pinned (`pin: "agent:<id>"` pins the chat, `pin: "page:<href>"` adds
 * the page to the Dock). Use from a widget that draws its own html around rows, so they keep the menu keys.
 * @param opts.items Rows to draw.
 * @param opts.pinned Pin ids (`agent:<id>`, `page:<href>`) currently pinned; read from the viewer when omitted.
 * @param opts.compact Smaller rows (chat lists). @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Rows to draw. */
        items: types.nav.Item[];
        /** Pin ids (`agent:<id>`, `page:<href>`) currently pinned; read from the viewer when omitted. */
        pinned?: Set<string>;
        /** Smaller rows (chat lists). @default false */
        compact?: boolean;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const local = (href: string) => href.startsWith("/") && !href.startsWith("//");
    let pinned = opts.pinned;
    if (!pinned && opts.items.some(item => item.pin)) {
        const [agents, layout] = await Promise.all([
            ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
            ctx.fns.dock.effectiveLayout({}).catch(() => ({ layout: { pins: [] as string[] } })),
        ]);
        pinned = new Set([...[...agents].map(id => `agent:${id}`), ...(layout.layout.pins ?? []).map(href => `page:${href}`)]);
    }
    return opts.items.map(item => {
        const href = String(item.href ?? "");
        // "+ create" rows look the same in every widget: a plus, primary text, a hairline under them.
        if (item.action) return `<div class="mb-1 border-b border-ui-border pb-1"><a href="${esc(local(href) ? href : "#")}"${item.id ? ` data-nav-id="${esc(item.id)}"` : ""} class="nav-row flex min-h-7 min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs font-medium text-primary outline-none hover:bg-primary/10"><i class="ph ${esc(/^ph-[a-z0-9-]+$/.test(String(item.icon ?? "")) ? item.icon : "ph-plus")} shrink-0" aria-hidden="true"></i><span class="min-w-0 flex-1 truncate">${esc(item.label)}</span></a></div>`;
        const isPinned = !!item.pin && !!pinned?.has(item.pin);
        let pin = "";
        const agentPin = item.pin?.startsWith("agent:") ? item.pin.slice(6) : "";
        const pagePin = item.pin?.startsWith("page:") ? item.pin.slice(5) : "";
        const button = (what: string) => `<button type="submit" title="${isPinned ? `Unpin ${what}` : `Pin ${what}`}" aria-label="${isPinned ? "Unpin" : "Pin"} ${esc(item.label)}" class="flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-muted"><i class="ph ${isPinned ? "ph-push-pin-slash" : "ph-push-pin"}"></i></button>`;
        const formClass = "shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-100";
        if (/^[A-Za-z0-9_-]+$/.test(agentPin)) pin = `<form hx-post="/nav/agent/${encodeURIComponent(agentPin)}/pin" hx-swap="none" class="${formClass}"><input type="hidden" name="pinned" value="${isPinned ? "0" : "1"}">${button("agent")}</form>`;
        else if (local(pagePin)) pin = `<form hx-post="/dock/pin" hx-swap="none" class="${formClass}"><input type="hidden" name="kind" value="page"><input type="hidden" name="target" value="${esc(pagePin)}"><input type="hidden" name="pinned" value="${isPinned ? "0" : "1"}"><button type="submit" title="${isPinned ? "Remove from" : "Add to"} Dock" aria-label="${isPinned ? "Remove" : "Add"} ${esc(item.label)} ${isPinned ? "from" : "to"} Dock" class="flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-muted"><i class="ph ${isPinned ? "ph-push-pin-slash" : "ph-push-pin"}"></i></button></form>`;
        const icon = item.model
            ? ctx.fns.chat.icon({ icon: item.avatar, model: item.model, active: !!item.active })
            : `<i class="ph ${esc(/^ph-[a-z0-9-]+$/.test(String(item.icon ?? "")) ? item.icon : "ph-arrow-square-out")} shrink-0 text-faint${item.detail ? " mt-0.5" : ""}" aria-hidden="true"></i>`;
        const mark = item.model && agentPin && isPinned ? '<i class="ph ph-push-pin-fill mr-1 text-faint opacity-50" aria-label="Pinned"></i>' : "";
        const compact = opts.compact || !!item.model;
        const label = compact
            ? `<span class="min-w-0 flex-1 truncate text-xs text-muted">${mark}${esc(item.label)}${item.model && agentPin ? ` <span class="font-mono text-3xs font-normal text-faint">(${esc(agentPin)})</span>` : ""}</span>`
            : item.detail
                ? `<span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium">${mark}${esc(item.label)}</span><span class="line-clamp-2 block text-3xs text-faint">${esc(item.detail)}</span></span>`
                : `<span class="min-w-0 flex-auto shrink truncate">${mark}${esc(item.label)}</span>`;
        const owner = item.owner ? `<span class="max-w-24 shrink-0 truncate text-3xs text-faint" data-owner>${esc(item.owner)}</span>` : "";
        const hint = item.hint ? `<span class="min-w-0 max-w-32 shrink-[100] truncate text-3xs text-faint">${esc(item.hint)}</span>` : "";
        const dot = item.unread ? `<span class="size-2 shrink-0 rounded-full bg-success" title="New activity" aria-label="New activity"></span>` : "";
        const size = compact ? "min-h-7 gap-1.5 px-1.5 py-0.5" : `min-h-8 gap-2 px-2 py-1 text-sm${item.detail ? " items-start" : ""}`;
        const safeHref = local(href) || /^https?:\/\//.test(href) ? href : "#";
        return `<div class="group flex items-center gap-0.5"><a href="${esc(safeHref)}"${item.newTab ? ' target="_blank" rel="noopener"' : ""}${item.id ? ` data-nav-id="${esc(item.id)}"` : ""} class="nav-row flex ${size} min-w-0 flex-1 items-center rounded text-left outline-none hover:bg-base-200/60">${icon}${label}${owner}${hint}${dot}</a>${pin}</div>`;
    }).join("");
}
