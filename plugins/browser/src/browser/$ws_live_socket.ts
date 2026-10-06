// /browser/live/socket — the live-view WebSocket. Sign-in and same-origin are
// already checked by the HTTP pipeline before this runs; each socket gets its
// own CDP connection, closed with the socket.
export default {
    async upgrade(ctx: Context, _session: Session | null, opts: { req: Request }) {
        const url = new URL(opts.req.url);
        try {
            const { browserUrl } = await ctx.fns.browser.liveCdp({ requested: url.searchParams.get("cdp") ?? undefined });
            return { browserUrl, targetId: url.searchParams.get("target") || undefined, conn: null, queue: [] as string[], ready: false };
        } catch (e: any) {
            return new Response(e.message, { status: 403 });
        }
    },
    async open(ctx: Context, _session: Session | null, opts: { ws: any }) {
        const ws = opts.ws;
        const st = ws.data.state;
        st.ws = ws;
        const quality = await ctx.fns.settings.getNumber({ module: "browser", scopeType: "global", key: "liveQuality", fallback: 70 } as any).catch(() => 70);
        try {
            st.conn = await ctx.fns.browser.liveConnect({
                viewer: { send: (d: any) => ws.send(d), getBufferedAmount: () => ws.getBufferedAmount(), close: (c?: number, r?: string) => ws.close(c, r) },
                browserUrl: st.browserUrl, targetId: st.targetId, quality: Number(quality) || 70,
            });
        } catch (e: any) {
            try { ws.send(JSON.stringify({ t: "error", message: e.message })); ws.close(1011, "cannot attach"); } catch { /* gone */ }
            return;
        }
        const live = (((ctx.state as any).browser ??= {}).live ??= new Set());
        live.add(st);
        st.ready = true;
        if (ws.readyState !== 1) { await st.conn.close(); live.delete(st); return; }
        for (const m of st.queue.splice(0)) await st.conn.handle(m);
    },
    async message(_ctx: Context, _session: Session | null, opts: { ws: any; message: string | Buffer }) {
        const st = opts.ws.data.state;
        const text = typeof opts.message === "string" ? opts.message : opts.message.toString();
        if (!st.ready) { if (st.queue.length < 200) st.queue.push(text); return; }
        await st.conn?.handle(text);
    },
    drain(_ctx: Context, _session: Session | null, opts: { ws: any }) {
        opts.ws.data.state.conn?.drain();
    },
    async close(ctx: Context, _session: Session | null, opts: { ws: any }) {
        const st = opts.ws.data.state;
        (ctx.state as any).browser?.live?.delete(st);
        await st.conn?.close();
    },
};
