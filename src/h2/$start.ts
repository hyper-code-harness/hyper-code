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
    const cfg = ctx.fns.procs.config.resolve({ module: "h2" }) as { enabled: string; redirect: string; port: number; host: string; http1: string };
    const on = (v: unknown) => !/^(0|false|off|no)$/i.test(String(v ?? "").trim());
    const port = Number(cfg.port);
    if (!on(cfg.enabled) || !port) {
        ctx.fns.procs.log.info({ event: "h2.disabled", msg: "HTTPS off (HYPER_HTTPS) — plain HTTP only" });
        return {};
    }
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

    // Tailscale name: a real Let's Encrypt certificate from `tailscale cert`, so
    // devices on the tailnet (iPad, phone) trust https://<mac>.<tailnet>.ts.net:3443
    // without installing anything. Without Tailscale the self-signed one is used.
    // `tailscale cert` renews only when needed, so running it on every start is cheap.
    const tsName = await tailscaleName();
    let hasTsCert = false;
    if (tsName) {
        const tsCert = `${dir}/ts.pem`, tsKey = `${dir}/ts-key.pem`;
        const p = Bun.spawn(["tailscale", "cert", "--cert-file", tsCert, "--key-file", tsKey, tsName], { stdout: "ignore", stderr: "pipe" });
        const code = await Promise.race([p.exited, Bun.sleep(30_000).then(() => { p.kill(); return -1; })]);
        if (code !== 0) ctx.fns.procs.log.warn({ event: "h2.tailscale-cert", msg: `tailscale cert failed (${code}); using the existing file if any` });
        if (await Bun.file(tsCert).exists()) hasTsCert = true;
    }

    // With Tailscale the listener serves ONLY the tailnet certificate. Choosing
    // a certificate per SNI name dropped ALPN in Bun, so the tailnet name silently
    // fell back to HTTP/1.1. On this Mac use https://<mac>.<tailnet>.ts.net:3443
    // too; https://localhost:3443 then shows a name mismatch (tests ignore it).
    const primary = hasTsCert ? { key: await Bun.file(`${dir}/ts-key.pem`).text(), cert: await Bun.file(`${dir}/ts.pem`).text() } : { key, cert };
    const server = http2.createSecureServer({
        // HTTP/1.1 is always negotiable: browsers open WebSockets over a separate
        // HTTP/1.1 connection (no RFC 8441 here), so refusing it at ALPN silently
        // breaks every $ws_ endpoint. HYPER_H2_HTTP1=off refuses plain HTTP/1.1
        // requests below instead and still lets WebSocket upgrades through.
        ...primary, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"],
    }, async (req, res) => {
        if (!ctx.fns.h2.http1Allowed({ httpVersion: req.httpVersion, http1: on(cfg.http1) })) {
            res.writeHead(505, { "content-type": "text/plain" });
            res.end("HTTP/2 only on this port (HYPER_H2_HTTP1=off); WebSocket upgrades are still accepted over HTTP/1.1");
            return;
        }
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
        // Mark the request as proxied. Loopback-only endpoints (/procs/repl,
        // /external/*, the sidebar bridge) reject forwarded traffic, so the REPL is
        // never reachable over the tailnet even though this listener is.
        headers.set("x-forwarded-for", req.socket?.remoteAddress ?? "unknown");
        headers.set("x-forwarded-proto", "https");
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const method = req.method ?? "GET";
        const body = method === "GET" || method === "HEAD" ? undefined
            : new ReadableStream({ start(c) { req.on("data", (d: Buffer) => c.enqueue(new Uint8Array(d))); req.on("end", () => c.close()); req.on("error", e => c.error(e)); } });
        try {
            const incoming = new Request(url, { method, headers, body, signal: abort.signal, duplex: "half" } as any);
            // Server-owned provenance, never a client-controlled forwarding header.
            const peers: WeakMap<Request, string> = ((ctx.state as any).httpTransportPeers ??= new WeakMap());
            peers.set(incoming, req.socket?.remoteAddress ?? "unknown");
            let out: Response;
            try {
                // Bun server.fetch clones Request and loses private provenance; invoke the same pipeline directly.
                out = await ctx.fns.procs.http.handle({ req: incoming, server: inner }) ?? new Response(null, { status: 500 });
            } finally { peers.delete(incoming); }
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
    // WebSockets arrive as HTTP/1.1 upgrades (no RFC 8441 over h2); see h2/wsProxy.
    server.on("upgrade", (req: any, socket: any, head: any) => ctx.fns.h2.wsProxy({ req, socket, head }));
    await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(port, cfg.host || "0.0.0.0", () => ok()); });
    ctx.fns.procs.log.info({ event: "h2.started", msg: `https://${tsName && hasTsCert ? tsName : "localhost"}:${port} (HTTP/2${on(cfg.http1) ? " + HTTP/1.1" : " only, HTTP/1.1 for WebSockets"}, experimental)` });
    // Prove the WebSocket path end to end once; a failure is logged, never fatal.
    void ctx.fns.h2.wsSelfCheck({ port, servername: hasTsCert ? tsName ?? undefined : undefined })
        .then((r) => r.ok
            ? ctx.fns.procs.log.info({ event: "h2.ws-ok", msg: `WebSocket upgrade through https port ${port}: ${r.detail}` })
            : ctx.fns.procs.log.warn({ event: "h2.ws-blocked", msg: `WebSocket upgrade through https port ${port} failed: ${r.detail} — live view and other $ws_ endpoints will not work on this address` }))
        .catch(() => {});
    return { server, port, tsName: hasTsCert ? tsName : null, redirect: on(cfg.redirect) };
}

// This machine's MagicDNS name, or null without Tailscale.
async function tailscaleName(): Promise<string | null> {
    try {
        const p = Bun.spawn(["tailscale", "status", "--json"], { stdout: "pipe", stderr: "ignore" });
        const out = await Promise.race([new Response(p.stdout).text(), Bun.sleep(5_000).then(() => { p.kill(); return ""; })]);
        const name = String(JSON.parse(out || "{}")?.Self?.DNSName ?? "").replace(/\.$/, "");
        return name || null;
    } catch { return null; }
}
