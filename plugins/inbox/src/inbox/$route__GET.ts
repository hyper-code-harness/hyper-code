/**
 * Renders the Inbox page: this Hyper's mail address and key state, received, sent and quarantined messages.
 * @param opts.req Request whose query selects the view (in, out, quarantine) and a search text.
 * @param opts.params Route parameters (unused).
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const w = ctx.fns.w;
    const esc = (v: unknown) => w.escape({ text: v });
    const url = new URL(opts.req.url);
    const view = (["in", "out", "quarantine"] as const).find(v => v === url.searchParams.get("view")) ?? "in";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = await ctx.fns.inbox.status({});
    const rows = view === "quarantine" ? await ctx.fns.inbox.list({ quarantined: true, limit: 200 })
        : (await ctx.fns.inbox.list({ direction: view, limit: 200 })).filter(m => view === "out" || m.verified);
    const visible = rows.filter(m => !q || `${m.from} ${m.to.join(" ")} ${m.subject ?? ""} ${m.text}`.toLowerCase().includes(q));
    const muted = w.mix({ mixes: [{ ink: "muted" }] });
    const row = (m: types.inbox.Message) => {
        const title = m.subject || m.text.split("\n")[0]!.slice(0, 120) || "(no text)";
        const href = `/inbox/${encodeURIComponent(m.id)}?direction=${m.direction}`;
        return w.record({
            entity: "inbox-message", id: m.id, status: m.verified ? (m.direction === "out" ? "sent" : m.deliveredAt ? "delivered" : "stored") : "quarantined",
            cells: [
                { role: "kind", html: w.icon({ name: !m.verified ? "warning" : m.direction === "out" ? "paper-plane-tilt" : "envelope-simple", size: 16 }), tone: !m.verified ? "danger" : m.direction === "out" ? "info" : m.deliveredAt ? "success" : undefined },
                { role: "peer", width: "name", text: m.direction === "out" ? `to ${m.to.join(", ")}` : `from ${m.from}` },
                { role: "title", grow: true, title, html: `<a href="${esc(href)}">${esc(title)}</a> <span class="${muted}">${esc(m.text.slice(0, 180))}</span>` },
                { role: "badge", html: !m.verified ? w.badge({ text: "unverified sender", tone: "danger" }) : m.agentId ? w.badge({ text: `agent ${m.agentId}`, tone: "info" }) : "" },
                { role: "time", wide: true, text: new Date(m.receivedAt).toLocaleString() + (m.reason ? ` · ${m.reason}` : "") },
            ],
        });
    };
    const lead = status.error ? `Not available: ${esc(status.error)}`
        : status.registered ? `Address ${esc(status.inbox)} · agents get &lt;agent id or alias&gt;@${esc(status.identity?.host)} · background sync ${status.running ? "on" : "off"}`
        : `Address ${esc(status.inbox)} · no key registered yet: call inbox.register`;
    const tabs = w.tabs({ variant: "underline", active: view, items: [
        { id: "in", label: "Received", icon: "tray", count: status.received, action: { href: "/inbox?view=in" } },
        { id: "out", label: "Sent", icon: "paper-plane-tilt", count: status.sent, action: { href: "/inbox?view=out" } },
        { id: "quarantine", label: "Quarantine", icon: "warning", count: status.quarantined, action: { href: "/inbox?view=quarantine" } },
    ] });
    const search = w.form({ form: "inbox-search", get: "/inbox", push: true, trigger: "input changed delay:250ms from:find input, submit",
        body: `<input type="hidden" name="view" value="${esc(view)}">${w.input({ name: "q", type: "search", value: q, placeholder: "Search mail", label: "Search mail", width: "auto" })}` });
    const empty = w.empty({ title: q ? "No matching mail" : "No mail here", hint: q ? `Nothing matches “${q}”.` : "Encrypted mail to this Hyper's agents appears here.", icon: "envelope-simple" });
    return {
        title: "Inbox",
        main: w.page({ page: "inbox", title: "Inbox", lead, body: w.toolbar({ start: tabs, end: search }) + (visible.length ? w.card({ flush: true, body: visible.map(row).join("") }) : empty) }),
    };
}
