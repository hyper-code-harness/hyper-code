/**
 * Draws menu rows (types.nav.Item) the way the global menu (⌘/) shows them everywhere — in widgets and in
 * search results — as w.listRow links marked `data-nav-row` (the menu's keys walk them) with an icon or model
 * logo, hint, unread dot and a hover 📌 toggle for rows that can be pinned (`pin: "agent:<id>"` pins the chat, `pin: "page:<href>"` adds
 * the page to the Dock). Use from a widget that draws its own html around rows, so they keep the menu keys.
 * @param opts.items Rows to draw.
 * @param opts.pinned Pin ids (`agent:<id>`, `page:<href>`) currently pinned; read from the viewer when omitted.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Rows to draw. */
        items: types.nav.Item[];
        /** Pin ids (`agent:<id>`, `page:<href>`) currently pinned; read from the viewer when omitted. */
        pinned?: Set<string>;
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
    const w = ctx.fns.w;
    return opts.items.map(item => {
        const href = String(item.href ?? "");
        const safeHref = local(href) || /^https?:\/\//.test(href) ? href : "#";
        const icon = /^ph-[a-z0-9-]+$/.test(String(item.icon ?? "")) ? String(item.icon).slice(3) : "";
        // data-nav-row is what the menu's keys walk (↑↓, ⌘←/→, ↵, ⌘↵); data-nav-id keeps the selection across redraws.
        const attrs = { "data-nav-row": true, "data-nav-id": item.id || undefined };
        // "+ create" rows look the same in every widget: a plus, blue text, a hairline under them.
        if (item.action) return w.listRow({ label: item.label, icon: icon || "plus", tone: "primary", action: { href: local(href) ? href : "#" }, attrs }) + w.divider({});
        const isPinned = !!item.pin && !!pinned?.has(item.pin);
        const agentPin = item.pin?.startsWith("agent:") ? item.pin.slice(6) : "";
        const pagePin = item.pin?.startsWith("page:") ? item.pin.slice(5) : "";
        const pinButton = (label: string, post: string, vals: Record<string, string>) =>
            w.iconButton({ icon: isPinned ? "push-pin-slash" : "push-pin", label, size: 24, action: { post, vals } });
        const end = /^[A-Za-z0-9_-]+$/.test(agentPin)
            ? pinButton(`${isPinned ? "Unpin" : "Pin"} agent ${item.label}`, `/nav/agent/${encodeURIComponent(agentPin)}/pin`, { pinned: isPinned ? "0" : "1" })
            : local(pagePin)
                ? pinButton(`${isPinned ? "Remove" : "Add"} ${item.label} ${isPinned ? "from" : "to"} Dock`, "/dock/pin", { kind: "page", target: pagePin, pinned: isPinned ? "0" : "1" })
                : undefined;
        const lead = item.model ? ctx.fns.w.chatIcon({ icon: item.avatar, model: item.model, active: !!item.active }) : undefined;
        const hint = [item.owner, item.hint].filter(Boolean).join(" · ") || undefined;
        return w.listRow({
            label: item.label,
            meta: item.model && agentPin ? `(${agentPin})` : undefined,
            detail: item.detail,
            lead,
            icon: lead ? undefined : icon || "arrow-square-out",
            hint,
            dot: item.unread ? "unread" : undefined,
            action: { href: safeHref },
            attrs: { ...attrs, "data-nav-pinned": isPinned || undefined, "data-nav-new-tab": item.newTab || undefined },
            end,
        });
    }).join("");
}
