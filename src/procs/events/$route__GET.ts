// GET /events — long-lived Server-Sent Events stream.
// Every page opens one; the server pushes reload / custom events down it. The
// stream doubles as presence: it begins when a tab opens and ends when it
// closes, which is a better answer to "who is here" than anything a heartbeat
// could give.
// `?topics=agent:eh,agents` narrows the stream SERVER-side: a tab watching one
// agent is not woken by every other agent's traffic. Global events (reload,
// notify) still reach everybody — see procs.events.emit.
/**
 * Handle the GET request for the events route.
 * @param opts.req The incoming HTTP request.
 */
export default async function (ctx: Context, session: Session, opts: { req: Request }) {
    const topics = (new URL(opts.req.url).searchParams.get("topics") ?? "")
        .split(",").map(t => t.trim()).filter(Boolean);
    let cancelStream = () => {};
    const stream = new ReadableStream({
        start(controller) {
            const enc = new TextEncoder();
            let closed = false;
            let keepalive: ReturnType<typeof setInterval> | undefined;
            let unsub = () => {};
            let leave = () => {};
            const cleanup = () => {
                if (closed) return;
                closed = true;
                if (keepalive) clearInterval(keepalive);
                leave();
                unsub();
                try { controller.close(); } catch { /* already closed */ }
            };
            cancelStream = cleanup;
            const send = (e: any) => {
                if (closed) return;
                try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); }
                catch { cleanup(); }
            };
            // A reconnecting tab may have missed signals while it was away, so
            // the greeting tells it to refresh what it shows — the same message
            // any change sends, which keeps recovery and normal operation on
            // one path instead of two.
            send({ type: "hello", serverStart: (ctx.state as any).serverStart, refresh: topics });
            unsub = ctx.fns.procs.events.subscribe({ handler: send, topics });
            // The stream is also the presence: it lasts exactly as long as the tab.
            leave = ctx.fns.procs.events.join({ topics });
            keepalive = setInterval(() => {
                try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { cleanup(); }
            }, 25_000);
            if (opts.req.signal.aborted) cleanup();
            else opts.req.signal.addEventListener("abort", cleanup, { once: true });
        },
        cancel() { cancelStream(); },
    });
    return new Response(stream, {
        headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            "connection": "keep-alive",
        },
    });
}
