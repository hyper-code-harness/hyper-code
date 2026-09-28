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
