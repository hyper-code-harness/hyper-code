import { expect, test } from "bun:test";
import middleware from "../$middleware";
import guard from "../http/guardRequest";
import publicOrigin from "../http/publicOrigin";

const nik = { id: "nik", email: null, name: "Nik", role: "owner", hasPassword: true, canSignIn: true, configuredAt: 1, createdAt: 1, disabledAt: null };

function context(who: { user: any; required: boolean }): any {
    const ctx: any = { fns: { auth: { currentUser: async () => who }, h2: { redirect: () => null }, settings: { get: async () => ["localhost", "hyper.example"] } }, state: { procs: { http: { server: { server: { requestIP: () => ({ address: "127.0.0.1" }) } } } } } };
    ctx.fns.http = { guardRequest: (o: any) => guard(ctx, null, o), publicOrigin: (o: any) => publicOrigin(ctx, null, o) };
    return ctx;
}

test("sign-in gate redirects HTML and rejects JSON", async () => {
    const ctx = context({ user: null, required: true });
    const html = await middleware(ctx, null, { req: new Request("https://hyper.example/agent/ab", { headers: { accept: "text/html", host: "hyper.example" } }) });
    expect(html?.status).toBe(303);
    expect(html?.headers.get("location")).toBe("/auth/login?next=%2Fagent%2Fab");
    const api = await middleware(ctx, null, { req: new Request("https://hyper.example/api/mobile/v1/agents", { headers: { accept: "application/json", host: "hyper.example" } }) });
    expect(api?.status).toBe(401);
});

test("open instance (no users, or one user without password) is unchanged", async () => {
    expect(await middleware(context({ user: null, required: false }), null, { req: new Request("http://localhost/agent/ab", { headers: { host: "localhost" } }) })).toBeUndefined();
    const session: any = {};
    expect(await middleware(context({ user: nik, required: false }), session, { req: new Request("http://localhost/agent/ab", { headers: { host: "localhost" } }) })).toBeUndefined();
    expect(session.user?.id).toBe("nik");
});

test("setup and login stay reachable before sign-in", async () => {
    const ctx = context({ user: null, required: true });
    expect(await middleware(ctx, null, { req: new Request("http://localhost/auth/setup", { headers: { host: "localhost" } }) })).toBeUndefined();
    expect(await middleware(ctx, null, { req: new Request("https://hyper.example/auth/login", { headers: { host: "hyper.example" } }) })).toBeUndefined();
});

test("signed-in user is attached to the session", async () => {
    const session: any = {};
    await middleware(context({ user: nik, required: true }), session, { req: new Request("https://hyper.example/agent/ab", { headers: { host: "hyper.example" } }) });
    expect(session.user?.id).toBe("nik");
});

test("authenticated cross-origin writes are rejected", async () => {
    const response = await middleware(context({ user: nik, required: true }), null, { req: new Request("https://hyper.example/api/mobile/v1/agents/ab/stop", { method: "POST", headers: { origin: "https://evil.example", host: "hyper.example" } }) });
    expect(response?.status).toBe(403);
});
