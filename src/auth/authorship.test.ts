import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

async function asUser(ctx: any, user: any) {
    const r: any = reqCtx(ctx);
    r.session.user = user;
    return r;
}

test("single user: outgoing transcript is byte-identical (no prefix, no extra system text)", async () => {
    const ctx = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai" });
    const r = await asUser(ctx, nik);
    const agent = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent });
    await r.fns.session.appendUserMessage({ id: agent.id, text: "hello" });
    const out = await ctx.fns.auth.attributeMessages({ messages: await ctx.fns.session.getMessages({ id: agent.id }) });
    expect(out.applied).toBe(false);
    expect(out.messages.at(-1).content).toBe("hello");
    const html = await ctx.fns.auth.badge({ userId: nik.id });
    expect(html).toBe("");
});

test("two users: every human message goes to the model as <Name>: text, stored text untouched", async () => {
    const ctx = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna K", email: "anna@health-samurai.io", password: "password-456" });
    const rn = await asUser(ctx, nik), ra = await asUser(ctx, anna);
    const agent = await rn.fns.agent.start({ model: "mock:echo" });
    await rn.fns.session.save({ agent });
    await rn.fns.session.appendUserMessage({ id: agent.id, text: "plan the release" });
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "assistant", content: "ok" } });
    await ra.fns.session.appendUserMessage({ id: agent.id, text: "add the migration step" });
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: [{ type: "image_ref", id: "x" }] } });

    const stored = await ctx.fns.session.getMessages({ id: agent.id });
    const out = await ctx.fns.auth.attributeMessages({ messages: stored });
    expect(out.applied).toBe(true);
    const users = out.messages.filter((m: any) => m.role === "user");
    expect(users[0].content).toBe("<Nikolai Ryzhikov>: plan the release");
    expect(users[1].content).toBe("<Anna K>: add the migration step");
    expect(users[2].content[0]).toEqual({ type: "text", text: "<Nikolai Ryzhikov>:" }); // background: chat owner
    expect(out.messages.find((m: any) => m.role === "assistant").content).toBe("ok");
    // Stored rows unchanged.
    const again = await ctx.fns.session.getMessages({ id: agent.id });
    expect(again.find((m: any) => m.role === "user").content).toBe("plan the release");

    // Rename is reflected at request time.
    await ctx.fns.auth.updateUser({ id: anna.id, name: "Anna Karenina" });
    const renamed = await ctx.fns.auth.attributeMessages({ messages: again });
    expect(renamed.messages.filter((m: any) => m.role === "user")[1].content).toStartWith("<Anna Karenina>: ");
});

test("chat shows the author badge on user messages once there are two users", async () => {
    const ctx = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna K", email: "anna@health-samurai.io", password: "password-456" });
    const rn = await asUser(ctx, nik), ra = await asUser(ctx, anna);
    const agent = await rn.fns.agent.start({ model: "mock:echo" });
    await rn.fns.session.save({ agent });
    await ra.fns.session.appendUserMessage({ id: agent.id, text: "hi from Anna" });
    const [ev] = await ctx.fns.procs.db.select({ sql: "SELECT actor, payload FROM events WHERE agent_id = ? AND type = 'user' ORDER BY idx DESC LIMIT 1", params: [agent.id] });
    expect(ev.actor).toBe(anna.id);
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
    expect(payload.html).toContain('data-author="anna"');
    expect(payload.html).toContain("Anna K");
    expect(payload.html).toContain(">AK<");
    expect(payload.html).toContain("rounded-br-md");
});

test("buildLlmRequest sends the prefix and the one-line explanation to the model", async () => {
    const ctx = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna K", email: "anna@health-samurai.io", password: "password-456" });
    const rn = await asUser(ctx, nik), ra = await asUser(ctx, anna);
    const agent = await rn.fns.agent.start({ model: "mock:echo" });
    await rn.fns.session.save({ agent });
    await ra.fns.session.appendUserMessage({ id: agent.id, text: "status?" });
    const loaded = await ctx.fns.session.load({ id: agent.id });
    const req: any = await ctx.fns.agent.buildLlmRequest({ agent: loaded });
    const all = JSON.stringify(req.messages);
    expect(all).toContain("<Anna K>: status?");
    expect(all).toContain("Each human message starts with `<Name>:`");
});

test("control-plane instance shows the author badge even with a single user", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OIDC_ISSUER: "https://cp.example" } });
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const html = await ctx.fns.auth.badge({ userId: nik.id });
    expect(html).toContain("Nikolai Ryzhikov");
    expect(html).toContain(">NR<");
});

test("photo from the ID token's picture claim is stored and shown as the avatar", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OIDC_ISSUER: "https://cp.example" } });
    const u = await ctx.fns.auth.linkIdentity({ provider: "oidc", sub: "val", email: "valeria@health-samurai.io", name: "Valeria F", picture: "https://lh3.googleusercontent.com/a/v=s96-c" });
    expect(u?.picture).toBe("https://lh3.googleusercontent.com/a/v=s96-c");
    // a later sign-in without a photo keeps it; a non-https photo is ignored
    await ctx.fns.auth.linkIdentity({ provider: "oidc", sub: "val", email: "valeria@health-samurai.io", name: "Valeria F", picture: "http://x/p.png" });
    expect((await ctx.fns.auth.getUser({ id: u!.id }))?.picture).toBe("https://lh3.googleusercontent.com/a/v=s96-c");
    const a = await ctx.fns.auth.author({ userId: u!.id });
    expect(a?.picture).toBe("https://lh3.googleusercontent.com/a/v=s96-c");
    const r = await asUser(ctx, u);
    const agent = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent });
    await r.fns.session.appendUserMessage({ id: agent.id, text: "hi" });
    const [ev] = await ctx.fns.procs.db.select({ sql: "SELECT payload FROM events WHERE agent_id = ? AND type = 'user' ORDER BY idx DESC LIMIT 1", params: [agent.id] });
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
    expect(payload.html).toContain('<img src="https://lh3.googleusercontent.com/a/v=s96-c"');
    expect(payload.html).toContain("Valeria F");
});

test("who is online: people with an open tab, with photo or initials, refreshed on join/leave", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OIDC_ISSUER: "https://cp.example" } });
    const val = await ctx.fns.auth.linkIdentity({ provider: "oidc", sub: "val", email: "valeria@health-samurai.io", name: "Valeria F", picture: "https://lh3.googleusercontent.com/a/v=s96-c" });
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    expect(await ctx.fns.auth.online({})).toBe("");
    const topics: string[] = [];
    ctx.fns.procs.events.subscribe({ handler: (e: any) => { if (e.topic) topics.push(e.topic); }, topics: ["presence"] });
    const leaveVal = ctx.fns.procs.events.join({}); // anonymous tab (no session user): ignored
    const r = await asUser(ctx, val);
    const leaveVal2 = r.fns.procs.events.join({});
    const leaveVal3 = r.fns.procs.events.join({}); // second tab: still one person
    const rn = await asUser(ctx, nik);
    const leaveNik = rn.fns.procs.events.join({});
    let html = await ctx.fns.auth.online({});
    expect(html).toContain('data-online="' + val!.id + '"');
    expect(html).toContain('<img src="https://lh3.googleusercontent.com/a/v=s96-c"');
    expect(html).toContain('(2 tabs)');
    expect(html).toContain('data-online="' + nik.id + '"');
    expect(html).toContain(">NR<");
    expect(html).toContain("ring-success");
    leaveNik();
    html = await ctx.fns.auth.online({});
    expect(html).not.toContain('data-online="' + nik.id + '"');
    leaveVal2(); leaveVal3(); leaveVal();
    expect(await ctx.fns.auth.online({})).toBe("");
    expect(topics.filter((t) => t === "presence").length).toBeGreaterThanOrEqual(4);
    const route = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/online" });
    expect(route.status).toBe(401); // signed-in people only
});
