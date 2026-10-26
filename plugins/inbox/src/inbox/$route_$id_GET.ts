/**
 * Renders one inbox message with its envelope (sender, verification, recipients, thread) and the rest of its thread.
 * @param opts.req Request whose query names the direction (in or out).
 * @param opts.params Route parameters with the message id.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const w = ctx.fns.w;
    const esc = (value: unknown) => w.escape({ text: value });
    const id = String(opts.params.id ?? "");
    const direction = new URL(opts.req.url).searchParams.get("direction") === "out" ? "out" : "in";
    const thread = await ctx.fns.inbox.list({ thread: id, limit: 500 });
    const m = thread.find(x => x.id === id && x.direction === direction) ?? thread.find(x => x.id === id);
    if (!m) return new Response("Not found", { status: 404 });
    const others = m.thread ? await ctx.fns.inbox.list({ thread: m.thread, limit: 500 }) : thread;
    const read = w.mix({ mixes: [{ text: "read" }] });
    const bubble = (x: types.inbox.Message) => w.card({
        title: `${x.direction === "out" ? "→ " + x.to.join(", ") : x.from} · ${new Date(x.receivedAt).toLocaleString()}`,
        body: `<pre class="${read}" style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;margin:0">${esc(x.text)}</pre>`,
    });
    const rest = others.filter(x => x.id !== m.id || x.direction !== m.direction);
    return {
        title: m.subject || "Message",
        main: w.page({
            page: "inbox-message",
            crumbs: w.crumbs({ items: [{ label: "Inbox", href: "/inbox" }, { label: `#${m.id.slice(0, 8)}` }] }),
            title: m.subject || m.text.split("\n")[0]!.slice(0, 120),
            lead: `${m.verified ? w.badge({ text: "verified sender", tone: "success" }) : w.badge({ text: "unverified sender", tone: "danger" })} <span class="${w.mix({ mixes: [{ ink: "muted", text: "small" }] })}">${m.direction === "out" ? "sent" : "received"} · hop ${m.hop}</span>`,
            body: rest.length ? [m, ...rest].sort((a, b) => a.receivedAt - b.receivedAt).map(bubble).join("") : bubble(m),
            aside: w.card({ title: "Envelope", body: w.keyValue({ items: [
                { key: "From", value: m.from },
                { key: "Sender identity", value: m.senderPrincipal ?? "unknown" },
                { key: "To", value: m.to.join(", ") },
                ...(m.reason ? [{ key: "Quarantine reason", value: m.reason }] : []),
                ...(m.agentId ? [{ key: "Agent", html: `<a href="/agent/${encodeURIComponent(m.agentId)}">${esc(m.agentId)}</a>` }] : []),
                { key: "Thread", value: m.thread ?? m.id },
            ] }) }),
        }),
    };
}
