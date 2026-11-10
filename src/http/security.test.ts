import { test, expect } from "bun:test";
import guard from "./guardRequest";
import publicOrigin from "./publicOrigin";
import middleware from "../$middleware";

function context(peer: string | undefined = "127.0.0.1", hosts = ["localhost", "127.0.0.1", "[::1]"], checkHosts = true) {
    const ctx: any = { state: { procs: { http: { server: { server: { requestIP: () => peer ? { address: peer } : null } } } } }, fns: {} };
    ctx.fns.settings = { get: async ({ key }: { key: string }) => key === "checkAllowedHosts" ? checkHosts : hosts };
    ctx.fns.http = { publicOrigin: (o: any) => publicOrigin(ctx, null, o), guardRequest: (o: any) => guard(ctx, null, o) };
    ctx.fns.h2 = { redirect: () => undefined };
    ctx.fns.auth = { currentUser: async () => ({ required: false }) };
    return ctx;
}
function request(host = "localhost:3000", headers: Record<string, string> = {}, path = "/settings", method = "POST") {
    return new Request(`http://${host}${path}`, { method, headers: { host, ...headers } });
}
for (const origin of ["https://evil.example", "null", "not a url", "http://localhost:3000/path", "http://user@localhost:3000", "https://localhost:3000"]) {
    test(`no-password middleware rejects Origin ${origin}`, async () => {
        expect((await middleware(context(), null, { req: request(undefined, { origin }) }))?.status).toBe(403);
    });
}
test("default port Host is allowed", async () => {
    expect(await guard(context(), null, { req: request("localhost:80", { origin: "http://localhost" }) })).toBeUndefined();
});
test("localhost browser and originless CLI accepted", async () => {
    for (const headers of [{}, { origin: "http://localhost:3000" }]) expect(await guard(context(), null, { req: request(undefined, headers) })).toBeUndefined();
});
test("domain checking disabled permits arbitrary same-origin host but retains other guards", async () => {
    const ctx = context("192.0.2.1", [], false);
    expect(await guard(ctx, null, { req: request("arbitrary.example", { origin: "http://arbitrary.example" }) })).toBeUndefined();
    expect((await guard(ctx, null, { req: request("arbitrary.example", { origin: "http://evil.example" }) }))?.status).toBe(403);
    expect((await guard(ctx, null, { req: request("arbitrary.example", { referer: "http://evil.example" }) }))?.status).toBe(403);
    expect((await guard(ctx, null, { req: request("arbitrary.example", {}, "/auth/setup") }))?.status).toBe(403);
});
test("same Origin/Host DNS rebinding is rejected", async () => {
    expect((await guard(context(), null, { req: request("evil.example:3000", { origin: "http://evil.example:3000" }) }))?.status).toBe(403);
});
test("explicit remote hostname is accepted", async () => {
    expect(await guard(context("192.0.2.1", ["hyper.example"]), null, { req: request("hyper.example", { origin: "http://hyper.example" }) })).toBeUndefined();
});
test("setup requires known loopback peer and rejects any forwarding", async () => {
    for (const peer of ["192.0.2.1", "unknown", ""]) expect((await guard(context(peer), null, { req: request(undefined, {}, "/auth/setup") }))?.status).toBe(403);
    for (const key of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]) {
        expect((await guard(context(), null, { req: request(undefined, { [key]: key === "x-forwarded-host" ? "localhost:3000" : "" }, "/auth/setup") }))?.status).toBe(403);
    }
    expect(await guard(context(), null, { req: request(undefined, {}, "/auth/setup") })).toBeUndefined();
});
test("forged forwarding from remote peer cannot authorize Origin", async () => {
    const req = request(undefined, { origin: "https://hyper.example", "x-forwarded-host": "hyper.example", "x-forwarded-proto": "https" });
    expect((await guard(context("192.0.2.1", ["localhost", "hyper.example"]), null, { req }))?.status).toBe(403);
    expect(await guard(context("127.0.0.1", ["localhost", "hyper.example"]), null, { req })).toBeUndefined();
});
test("guard precedes redirect, public routes and sidebar exemptions", async () => {
    const ctx = context();
    ctx.fns.h2.redirect = () => { throw Error("must not redirect"); };
    for (const path of ["/auth/login", "/sidebar/api/test", "/sidebar/approve/test", "/procs/repl"]) expect((await middleware(ctx, null, { req: request("evil.example", {}, path, "GET") }))?.status).toBe(403);
});
test("originless browser writes fail closed and Referer is validated", async () => {
    for (const headers of [{ "sec-fetch-site": "same-site" }, { "sec-fetch-site": "same-origin" }, { referer: "https://evil.example/a" }, { referer: "null" }]) {
        expect((await guard(context(), null, { req: request(undefined, headers) }))?.status).toBe(403);
    }
});
test("setup route slash aliases cannot bypass loopback restriction", async () => {
    for (const path of ["/auth/setup/", "/auth//setup", "//auth/setup"]) expect((await guard(context("192.0.2.1"), null, { req: request(undefined, {}, path) }))?.status).toBe(403);
});
test("cross-site originless writes and cross-origin WebSockets rejected", async () => {
    expect((await guard(context(), null, { req: request(undefined, { "sec-fetch-site": "cross-site" }) }))?.status).toBe(403);
    expect((await guard(context(), null, { req: request(undefined, { origin: "https://evil.example", upgrade: "websocket" }, "/socket", "GET") }))?.status).toBe(403);
});
