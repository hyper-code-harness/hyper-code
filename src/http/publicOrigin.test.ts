import { test, expect } from "bun:test";
import publicOrigin from "./publicOrigin";
import guard from "./guardRequest";

function context(peer: string | undefined) {
    const ctx: any = { state: { procs: { http: { server: { server: { requestIP: () => peer ? { address: peer } : null } } } } }, fns: {} };
    ctx.fns.settings = { get: async ({ key }: { key: string }) => key === "checkAllowedHosts" ? false : [] };
    ctx.fns.http = { publicOrigin: (opts: { req: Request }) => publicOrigin(ctx, null, opts) };
    return ctx;
}
function request(proto: string, origin = "https://hyper.example", host = "hyper.example") {
    return new Request("http://hyper.example/live", { headers: {
        host: "hyper.example", origin, upgrade: "websocket", cookie: "session=test",
        "x-forwarded-proto": proto, "x-forwarded-host": host,
    } });
}
for (const proto of ["https", "wss", "http", "ws"]) {
    test(`trusted proxy ${proto} resolves HTTP browser origin`, async () => {
        const expected = ["https", "wss"].includes(proto) ? "https://hyper.example" : "http://hyper.example";
        const req = request(proto, expected);
        expect(await publicOrigin(context("127.0.0.1"), null, { req })).toBe(expected);
        expect(await guard(context("127.0.0.1"), null, { req })).toBeUndefined();
        expect(req.headers.get("cookie")).toBe("session=test");
    });
}
test("TLS proxy WS rejects foreign and wrong-scheme Origin", async () => {
    for (const origin of ["https://evil.example", "http://hyper.example", "wss://hyper.example", "null"]) {
        expect((await guard(context("127.0.0.1"), null, { req: request("wss", origin) }))?.status).toBe(403);
    }
});
test("remote or unknown peers cannot forge any forwarded scheme", async () => {
    for (const peer of ["192.0.2.1", undefined]) for (const proto of ["https", "wss"]) {
        expect((await guard(context(peer), null, { req: request(proto) }))?.status).toBe(403);
    }
});
test("invalid schemes and authorities never authorize HTTPS Origin", async () => {
    for (const proto of ["ftp", "javascript", "https,wss"]) {
        expect((await guard(context("127.0.0.1"), null, { req: request(proto) }))?.status).toBe(403);
    }
    for (const host of ["hyper.example@evil.example", "hyper.example/path", "hyper.example:99999", "hyper.example,evil.example"]) {
        expect((await guard(context("127.0.0.1"), null, { req: request("wss", "https://hyper.example", host) }))?.status).toBe(403);
    }
});
