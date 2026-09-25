import { expect, test } from "bun:test";
import middleware from "../$middleware";

const nik = { id: "nik", email: null, name: "Nik", role: "owner", hasPassword: true, configuredAt: 1, createdAt: 1, disabledAt: null };

function context(who: { user: any; required: boolean }): any {
    return { fns: { auth: { currentUser: async () => who } }, state: {} };
}

test("sign-in gate redirects HTML and rejects JSON", async () => {
    const ctx = context({ user: null, required: true });
    const html = await middleware(ctx, null, { req: new Request("https://hyper.example/agent/ab", { headers: { accept: "text/html" } }) });
    expect(html?.status).toBe(303);
    expect(html?.headers.get("location")).toBe("/auth/login?next=%2Fagent%2Fab");
    const api = await middleware(ctx, null, { req: new Request("https://hyper.example/api/mobile/v1/agents", { headers: { accept: "application/json" } }) });
    expect(api?.status).toBe(401);
});

test("open instance (no users, or one user without password) is unchanged", async () => {
    expect(await middleware(context({ user: null, required: false }), null, { req: new Request("http://localhost/agent/ab") })).toBeUndefined();
    const session: any = {};
    expect(await middleware(context({ user: nik, required: false }), session, { req: new Request("http://localhost/agent/ab") })).toBeUndefined();
    expect(session.user?.id).toBe("nik");
});

test("setup and login stay reachable before sign-in", async () => {
    const ctx = context({ user: null, required: true });
    expect(await middleware(ctx, null, { req: new Request("https://hyper.example/auth/setup") })).toBeUndefined();
    expect(await middleware(ctx, null, { req: new Request("https://hyper.example/auth/login") })).toBeUndefined();
});

test("signed-in user is attached to the session", async () => {
    const session: any = {};
    await middleware(context({ user: nik, required: true }), session, { req: new Request("https://hyper.example/agent/ab") });
    expect(session.user?.id).toBe("nik");
});

test("authenticated cross-origin writes are rejected", async () => {
    const response = await middleware(context({ user: nik, required: true }), null, { req: new Request("https://hyper.example/api/mobile/v1/agents/ab/stop", { method: "POST", headers: { origin: "https://evil.example", host: "hyper.example" } }) });
    expect(response?.status).toBe(403);
});
