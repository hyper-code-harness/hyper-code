// `$ws_<path>.ts` WebSocket endpoints over a real Bun server on a free port:
// classification, the shared middleware gate, cross-origin refusal, params,
// per-connection state, and the HTTPS door's HTTP/1.1 upgrade proxy.
import { test, expect, afterAll } from "bun:test";
import http2 from "node:http2";
import http from "node:http";
import { testCtx } from "../../$test";

const ctx = await testCtx();
const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }),
    websocket: ctx.fns.procs.http.socketHandlers({}) as any,
});
ctx.state.procs.http.server = { server, port: server.port! };
const closed: string[] = [];

ctx.state.procs.http.routes["/t/echo/:room"] = {
    WS: {
        from: "test",
        upgrade: (_c: Context, s: any, o: any) => ({ room: o.params.room, user: s.user ?? null, n: 0 }),
        open: (_c: Context, _s: any, o: any) => o.ws.send(`hello ${o.ws.data.state.room} ${o.ws.data.state.user}`),
        message: (_c: Context, _s: any, o: any) => { o.ws.data.state.n++; o.ws.send(`${o.ws.data.state.n}:${o.message}`); },
        close: (_c: Context, _s: any, o: any) => { closed.push(o.ws.data.state.room); },
    } as any,
};
ctx.state.procs.http.routes["/t/refuse"] = { WS: { upgrade: () => new Response("nope", { status: 409 }) } as any };
ctx.state.procs.http.middleware = [
    { prefix: "/t", segs: ["t"], handler: (_c: Context, s: any, o: any) => {
        if (new URL(o.req.url).searchParams.get("deny")) return new Response("denied", { status: 401 });
        s.user = "alice";
    } },
];

afterAll(() => { server.stop(true); ctx.state.procs.http.middleware = []; });

// Status of a plain request, through node:http: other test files in the same
// `bun test` process replace globalThis.fetch with mocks.
const statusOf = (path: string, headers: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.port, path, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 101); });
    req.on("error", reject);
    req.end();
});
const UPGRADE = { upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };

const conversation = (url: string, send: string[], init?: any) => new Promise<{ got: string[]; code?: number }>((resolve) => {
    const ws = new WebSocket(url, init);
    const got: string[] = [];
    ws.onmessage = (e) => { got.push(String(e.data)); if (got.length === 1) send.forEach((m) => ws.send(m)); if (got.length === send.length + 1) ws.close(); };
    ws.onclose = (e) => resolve({ got, code: e.code });
    ws.onerror = () => resolve({ got, code: -1 });
});

test("classify: $ws_<path>.ts is a ws entry addressed like a route", () => {
    const e = ctx.fns.procs.project.classify({ rel: "browser/$ws_live_$tab.ts" });
    expect([e.kind, e.routePath]).toEqual(["ws", "/browser/live/:tab"]);
    expect(ctx.fns.procs.project.classify({ rel: "chat/$ws.ts" }).routePath).toBe("/chat");
});

test("upgrade runs middleware, carries params, session and state per connection", async () => {
    const r = await conversation(`ws://127.0.0.1:${server.port}/t/echo/r1`, ["a", "b"]);
    expect(r.got).toEqual(["hello r1 alice", "1:a", "2:b"]);
    await Bun.sleep(30);
    expect(closed).toContain("r1");
});

test("middleware can refuse the upgrade", async () => {
    expect(await statusOf("/t/echo/x?deny=1", UPGRADE)).toBe(401);
    expect(await statusOf("/t/echo/x", UPGRADE)).toBe(101);
});

test("endpoint upgrade hook can refuse; cross-origin handshakes are rejected", async () => {
    expect(await statusOf("/t/refuse", UPGRADE)).toBe(409);
    expect(await statusOf("/t/echo/x", { ...UPGRADE, origin: "https://evil.example" })).toBe(403);
});

test("plain GET on a ws-only address is still a 404", async () => {
    expect(await statusOf("/t/echo/x")).toBe(404);
});

test("HTTPS door forwards HTTP/1.1 WebSocket upgrades to the plain server", async () => {
    const dir = `/tmp/hyper-ws-test-${process.pid}`;
    const gen = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", `${dir}-k.pem`, "-out", `${dir}-c.pem`, "-subj", "/CN=localhost"]);
    expect(gen.exitCode).toBe(0);
    const tls = http2.createSecureServer({ key: await Bun.file(`${dir}-k.pem`).text(), cert: await Bun.file(`${dir}-c.pem`).text(), allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] }, (_q, s) => s.end());
    tls.on("upgrade", (req: any, socket: any, head: any) => ctx.fns.h2.wsProxy({ req, socket, head }));
    await new Promise<void>((ok) => tls.listen(0, "127.0.0.1", () => ok()));
    const port = (tls.address() as any).port;
    try {
        const r = await conversation(`wss://localhost:${port}/t/echo/tls`, ["z"], { tls: { rejectUnauthorized: false } });
        expect(r.got).toEqual(["hello tls alice", "1:z"]);
    } finally { tls.close(); }
});
