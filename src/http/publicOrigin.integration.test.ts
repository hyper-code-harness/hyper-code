import { test, expect } from "bun:test";
import http from "node:http";
import guard from "./guardRequest";
import publicOrigin from "./publicOrigin";

test("real HTTP WS proxy headers retain origin guard, cookie auth and frames", async () => {
    const ctx: any = { state: { procs: { http: {} } }, fns: {} };
    ctx.fns.settings = { get: async ({ key }: { key: string }) => key === "checkAllowedHosts" ? false : [] };
    ctx.fns.http = { publicOrigin: (opts: { req: Request }) => publicOrigin(ctx, null, opts) };
    const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        async fetch(req, srv) {
            const rejected = await guard(ctx, null, { req });
            if (rejected) return rejected;
            if (req.headers.get("cookie") !== "session=valid") return new Response("unauthorized", { status: 401 });
            return srv.upgrade(req) ? undefined : new Response("ordinary HTTP", { status: 200 });
        },
        websocket: { open(ws) { ws.send("frame"); }, message() {} },
    });
    ctx.state.procs.http.server = { server, port: server.port };
    const headers = { host: "hyper.example", origin: "https://hyper.example", "x-forwarded-proto": "wss", "x-forwarded-host": "hyper.example", upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };
    const status = (extra: Record<string, string>) => new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: server.port, headers: { ...headers, ...extra } }, res => { res.resume(); resolve(res.statusCode!); });
        req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode!); });
        req.on("error", reject); req.end();
    });
    try {
        expect(await status({})).toBe(401);
        expect(await status({ cookie: "session=valid", origin: "https://evil.example" })).toBe(403);
        expect(await status({ cookie: "session=valid", origin: "http://hyper.example" })).toBe(403);
        expect(await status({ cookie: "session=valid" })).toBe(101);
        const frame = await new Promise<string>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: { ...headers, cookie: "session=valid" } });
            const timer = setTimeout(() => { ws.close(); reject(new Error("no frames")); }, 3000);
            ws.onmessage = e => { clearTimeout(timer); resolve(String(e.data)); ws.close(); };
            ws.onerror = () => { clearTimeout(timer); reject(new Error("WS failed")); };
        });
        expect(frame).toBe("frame");
        expect(await status({ cookie: "session=valid", upgrade: "", "x-forwarded-proto": "https" })).toBe(200);
    } finally { server.stop(true); }
});
