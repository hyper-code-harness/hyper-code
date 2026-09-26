// A second, EXPERIMENTAL door into the same process: HTTPS with HTTP/2 on its own
// port (default 3443), next to the untouched plain-HTTP one on procs/http's port.
//
// Why: over HTTP/1.1 Chrome allows six connections per origin, and every visible
// Hyper tab keeps one of them open for the live-update stream. Enough tabs and
// ordinary requests queue behind those streams — pages stop loading scripts. HTTP/2
// multiplexes every request of an origin over one connection, so the limit is gone.
// Browsers only speak HTTP/2 over TLS, hence the certificate.
//
// It does not route anything itself: every request is handed to the running
// Bun server's own fetch handler, so middleware, auth, routes and SSE behave
// exactly as on the old port. Starts after procs/http (lifecycle orders http last,
// so this module is listed after it and waits for the server if needed).
import http2 from "node:http2";
import { mkdir } from "node:fs/promises";

/** Start the HTTPS/HTTP2 listener that proxies into the main Bun server in-process. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const port = Number((ctx.fns.procs.config.resolve({ module: "h2" }) as { port: number }).port);
    if (!port) return {};
    const dir = `${ctx.fns.procs.project.runtimeDir({})}/tls`;
    const keyPath = `${dir}/localhost-key.pem`, certPath = `${dir}/localhost.pem`;
    if (!(await Bun.file(certPath).exists())) {
        await mkdir(dir, { recursive: true });
        // Self-signed for localhost / 127.0.0.1. Trust it once in the system keychain
        // (or use mkcert) to get rid of the browser warning.
        const r = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
            "-keyout", keyPath, "-out", certPath, "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
        if (r.exitCode !== 0) throw new Error("h2: openssl failed: " + r.stderr.toString());
    }
    const [key, cert] = await Promise.all([Bun.file(keyPath).text(), Bun.file(certPath).text()]);

    const server = http2.createSecureServer({ key, cert, allowHTTP1: true }, async (req, res) => {
        const inner = (ctx.state.procs.http.server as any)?.server;
        if (!inner?.fetch) { res.writeHead(503); res.end("http server not ready"); return; }
        const authority = (req.headers[":authority"] as string) || (req.headers.host as string) || `localhost:${port}`;
        const url = `https://${authority}${req.url}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
            if (k.startsWith(":") || v == null) continue;
            if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else headers.set(k, String(v));
        }
        headers.set("host", authority);
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const method = req.method ?? "GET";
        const body = method === "GET" || method === "HEAD" ? undefined
            : new ReadableStream({ start(c) { req.on("data", d => c.enqueue(new Uint8Array(d))); req.on("end", () => c.close()); req.on("error", e => c.error(e)); } });
        try {
            const out: Response = await inner.fetch(new Request(url, { method, headers, body, signal: abort.signal, duplex: "half" } as any));
            const h: Record<string, string | string[]> = {};
            out.headers.forEach((v, k) => {
                // Connection-specific headers are illegal in HTTP/2.
                if (["connection", "keep-alive", "transfer-encoding", "upgrade"].includes(k)) return;
                if (k === "set-cookie") return;
                h[k] = v;
            });
            const cookies = (out.headers as any).getSetCookie?.() ?? [];
            if (cookies.length) h["set-cookie"] = cookies;
            res.writeHead(out.status, h);
            if (!out.body || method === "HEAD") { res.end(); return; }
            const reader = out.body.getReader();
            abort.signal.addEventListener("abort", () => reader.cancel().catch(() => {}), { once: true });
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!res.write(value)) await new Promise(r => res.once("drain", r));
            }
            res.end();
        } catch (e: any) {
            if (!res.headersSent) { res.writeHead(502); res.end(String(e?.message ?? e)); } else res.destroy();
        }
    });
    await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(port, "0.0.0.0", () => ok()); });
    ctx.fns.procs.log.info({ event: "h2.started", msg: `https://localhost:${port} (HTTP/2, experimental)` });
    return { server, port };
}
