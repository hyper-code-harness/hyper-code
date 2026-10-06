// The `websocket` block for Bun.serve. Bun has one set of socket handlers per
// server, so they only route each event to the endpoint the socket was upgraded
// for (`ws.data.endpoint`), with the upgrade's own ctx and session.

/**
 * Builds the Bun.serve `websocket` handlers that route socket events to `$ws_<path>.ts` endpoints.
 *
 * Use when starting (or live-reloading) the HTTP server. Each event calls the endpoint handler stored on
 * `ws.data` at upgrade time; a throwing handler is logged and closes that one socket with code 1011.
 * @param opts.idleTimeout Seconds of silence before Bun closes a socket. @default 120 @minimum 0 @maximum 960
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Seconds of silence before Bun closes a socket. @default 120 @minimum 0 @maximum 960 */
        idleTimeout?: number;
    } = {},
): Record<string, unknown> {
    const run = async (ws: any, event: "open" | "message" | "close" | "drain", extra: Record<string, unknown>) => {
        const data = ws.data as types.procs.http.WsData | undefined;
        const handler = data?.endpoint?.[event];
        if (!data || typeof handler !== "function") return;
        try {
            await (handler as Function)(data.ctx, data.session, { ws, ...extra });
        } catch (e: any) {
            ctx.fns.procs.log.error({ event: "ws.error", msg: `${event} ${data.path}: ${e?.message ?? e}`, from: data.endpoint.from });
            if (event !== "close") { try { ws.close(1011, "endpoint error"); } catch { /* already closed */ } }
        }
    };
    return {
        idleTimeout: opts.idleTimeout ?? 120,
        // Frames from a screencast are already compressed images; deflating them costs CPU for nothing.
        perMessageDeflate: false,
        backpressureLimit: 8 * 1024 * 1024,
        open: (ws: any) => run(ws, "open", {}),
        message: (ws: any, message: string | Buffer) => run(ws, "message", { message }),
        close: (ws: any, code: number, reason: string) => run(ws, "close", { code, reason }),
        drain: (ws: any) => run(ws, "drain", {}),
    };
}
