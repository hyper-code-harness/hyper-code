/**
 * Renders one inbox message with its envelope (sender, verification, recipients, thread) and the rest of its thread.
 * @param opts.req Request whose query names the direction (in or out).
 * @param opts.params Route parameters with the message id.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const ui = ctx.fns.procs.ui;
    const esc = (value: unknown) => ui.escape({ text: value });
    const id = String(opts.params.id ?? "");
    const direction = new URL(opts.req.url).searchParams.get("direction") === "out" ? "out" : "in";
    const thread = await ctx.fns.inbox.list({ thread: id, limit: 500 });
    const m = thread.find(x => x.id === id && x.direction === direction) ?? thread.find(x => x.id === id);
    if (!m) return new Response("Not found", { status: 404 });
    const others = m.thread ? await ctx.fns.inbox.list({ thread: m.thread, limit: 500 }) : thread;
    const bubble = (x: types.inbox.Message) => ui.card({
        title: `${x.direction === "out" ? "→ " + x.to.join(", ") : x.from} · ${new Date(x.receivedAt).toLocaleString()}`,
        body: `<pre class="whitespace-pre-wrap break-words font-sans text-sm">${esc(x.text)}</pre>`,
    });
    return {
        title: m.subject || "Message",
        main: ui.detailPage({
            page: "inbox-message",
            back: { href: "/inbox", label: "Back to inbox" },
            title: m.subject || m.text.split("\n")[0]!.slice(0, 120),
            id: m.id.slice(0, 8),
            status: m.verified ? ui.badge({ text: "verified sender", tone: "success" }) : ui.badge({ text: "unverified sender", tone: "error" }),
            meta: [m.direction === "out" ? "sent" : "received", `hop ${m.hop}`],
            main: others.filter(x => x.id !== m.id || x.direction !== m.direction).length ? [m, ...others.filter(x => x.id !== m.id || x.direction !== m.direction)].sort((a, b) => a.receivedAt - b.receivedAt).map(bubble).join("") : bubble(m),
            aside: [{ title: "Envelope", body: ui.descriptionList({ cols: 1, items: [
                { term: "From", detail: m.from },
                { term: "Sender identity", detail: m.senderPrincipal ?? "unknown" },
                { term: "To", detail: m.to.join(", ") },
                ...(m.reason ? [{ term: "Quarantine reason", detail: m.reason }] : []),
                ...(m.agentId ? [{ term: "Agent", html: `<a class="link" href="/agent/${encodeURIComponent(m.agentId)}">${esc(m.agentId)}</a>` }] : []),
                { term: "Thread", detail: m.thread ?? m.id },
            ] }) }],
        }),
    };
}
