// WebSockets through the HTTPS door. Browsers do not run WebSockets over the
// HTTP/2 connection unless the server announces RFC 8441 extended CONNECT,
// which node:http2 does not; Chrome then opens a separate HTTP/1.1 connection
// for the socket, the TLS listener (allowHTTP1) emits `upgrade`, and this pipes
// the raw bytes to the plain HTTP server inside the same process. That server
// runs the ordinary pipeline — middleware, auth, `$ws_` endpoints — and sees
// the request as forwarded, exactly like a proxied page.
import net from "node:net";

/**
 * Forwards one HTTP/1.1 WebSocket upgrade from the HTTPS listener to the in-process plain HTTP server.
 *
 * Use as the node:http2 secure server `upgrade` listener. Rewrites forwarding headers (x-forwarded-for,
 * x-forwarded-proto=https, x-forwarded-host) and pipes both directions until either side closes.
 * With HYPER_H2_HTTP1=off there is no HTTP/1.1 on the HTTPS port and WebSockets must use the plain port.
 * @param opts.req Node IncomingMessage of the upgrade request.
 * @param opts.socket Client TLS socket taken over from the HTTPS server.
 * @param opts.head Bytes already read past the request headers.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Node IncomingMessage of the upgrade request. */
        req: any;
        /** Client TLS socket taken over from the HTTPS server. */
        socket: any;
        /** Bytes already read past the request headers. */
        head?: Uint8Array;
    },
): { forwarded: boolean } {
    const { req, socket } = opts;
    const inner = ctx.state.procs.http.server as { port?: number } | undefined;
    if (!inner?.port) { socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); return { forwarded: false }; }
    const lines: string[] = [`${req.method} ${req.url} HTTP/1.1`];
    const raw: string[] = req.rawHeaders ?? [];
    const skip = new Set(["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]);
    for (let i = 0; i + 1 < raw.length; i += 2) {
        if (skip.has(String(raw[i]).toLowerCase())) continue;
        lines.push(`${raw[i]}: ${raw[i + 1]}`);
    }
    lines.push(`x-forwarded-for: ${socket.remoteAddress ?? "unknown"}`, "x-forwarded-proto: https");
    if (req.headers?.host) lines.push(`x-forwarded-host: ${req.headers.host}`);
    const upstream = net.connect(inner.port, "127.0.0.1", () => {
        upstream.write(lines.join("\r\n") + "\r\n\r\n");
        if (opts.head?.length) upstream.write(opts.head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    const end = () => { upstream.destroy(); socket.destroy(); };
    upstream.on("error", end);
    socket.on("error", end);
    upstream.on("close", end);
    socket.on("close", end);
    return { forwarded: true };
}
