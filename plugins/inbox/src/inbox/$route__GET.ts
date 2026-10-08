/**
 * Renders the Inbox page: this Hyper's mail address and key state, received, sent and quarantined messages.
 * @param opts.req Request whose query selects the view (in, out, quarantine) and a search text.
 * @param opts.params Route parameters (unused).
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const ui = ctx.fns.procs.ui;
    const url = new URL(opts.req.url);
    const view = (["in", "out", "quarantine"] as const).find(v => v === url.searchParams.get("view")) ?? "in";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = await ctx.fns.inbox.status({});
    const rows = view === "quarantine" ? await ctx.fns.inbox.list({ quarantined: true, limit: 200 })
        : (await ctx.fns.inbox.list({ direction: view, limit: 200 })).filter(m => view === "out" || m.verified);
    const visible = rows.filter(m => !q || `${m.from} ${m.to.join(" ")} ${m.subject ?? ""} ${m.text}`.toLowerCase().includes(q));
    const row = (m: types.inbox.Message) => ui.listItem({
        entity: "inbox-message", id: m.id, status: m.verified ? (m.direction === "out" ? "sent" : m.deliveredAt ? "delivered" : "stored") : "quarantined",
        href: `/inbox/${encodeURIComponent(m.id)}?direction=${m.direction}`,
        icon: !m.verified ? "ph-warning" : m.direction === "out" ? "ph-paper-plane-tilt" : "ph-envelope-simple",
        tone: !m.verified ? "error" : m.direction === "out" ? "info" : m.deliveredAt ? "success" : "neutral",
        title: m.subject || m.text.split("\n")[0]!.slice(0, 120) || "(no text)",
        badges: !m.verified ? ui.badge({ text: "unverified sender", tone: "error" }) : m.agentId ? ui.badge({ text: `agent ${m.agentId}`, tone: "info" }) : "",
        text: m.text.slice(0, 180),
        meta: [m.direction === "out" ? `to ${m.to.join(", ")}` : `from ${m.from}`, new Date(m.receivedAt).toLocaleString(), ...(m.reason ? [m.reason] : [])],
    });
    const lead = status.error ? `Not available: ${status.error}`
        : status.registered ? `Address ${status.inbox} · agents get <agent id or alias>@${status.identity?.host} · background sync ${status.running ? "on" : "off"}`
        : `Address ${status.inbox} · no key registered yet: call inbox.register`;
    return {
        title: "Inbox",
        main: ui.listPage({
            page: "inbox", title: "Inbox", lead,
            tabs: ui.tabs({ current: view, items: [
                { value: "in", label: "Received", icon: "ph-tray", count: status.received, href: "/inbox?view=in" },
                { value: "out", label: "Sent", icon: "ph-paper-plane-tilt", count: status.sent, href: "/inbox?view=out" },
                { value: "quarantine", label: "Quarantine", icon: "ph-warning", count: status.quarantined, href: "/inbox?view=quarantine" },
            ] }),
            filters: ui.filterBar({ href: "/inbox", q, placeholder: "Search mail", hidden: { view } }),
            rows: visible.map(row).join(""),
            empty: { title: q ? "No matching mail" : "No mail here", text: q ? `Nothing matches “${q}”.` : "Encrypted mail to this Hyper's agents appears here.", icon: "ph-envelope-simple" },
        }),
    };
}
