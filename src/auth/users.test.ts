import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

const cookieFor = async (ctx: any, user: any) => {
    const token = await ctx.fns.procs.auth.sign({ sub: user.id, name: user.name, role: user.role, days: 1 });
    return `${ctx.fns.procs.auth.cookieName({})}=${token}`;
};
const req = (cookie?: string) => new Request("http://localhost/agent/ab", cookie ? { headers: { cookie } } : {});

test("no users: open, nobody signed in", async () => {
    const ctx = await mkTestCtx();
    expect(await ctx.fns.auth.currentUser({ req: req() })).toEqual({ user: null, required: false });
});

test("single user without password: open, but the session knows who it is", async () => {
    const ctx = await mkTestCtx();
    const u = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov" });
    expect(u.id).toBe("nikolai-ryzhikov");
    expect(u.role).toBe("owner");
    const who = await ctx.fns.auth.currentUser({ req: req() });
    expect(who.required).toBe(false);
    expect(who.user?.id).toBe(u.id);
});

test("single user with password: password-only sign-in, email not needed", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.auth.createUser({ name: "Nik", password: "password-123" });
    expect((await ctx.fns.auth.verifyUser({ password: "password-123" }))?.name).toBe("Nik");
    expect(await ctx.fns.auth.verifyUser({ password: "wrong-password" })).toBeNull();
    expect((await ctx.fns.auth.currentUser({ req: req() })).required).toBe(true);
});

test("second user requires email + password for everyone, then email sign-in", async () => {
    const ctx = await mkTestCtx();
    const owner = await ctx.fns.auth.createUser({ name: "Nik", password: "password-123" });
    await expect(ctx.fns.auth.createUser({ name: "Anna", email: "anna@x.test", password: "password-456" })).rejects.toThrow(/Nik first/);
    await ctx.fns.auth.updateUser({ id: owner.id, email: "nik@x.test" });
    await expect(ctx.fns.auth.createUser({ name: "Anna" })).rejects.toThrow(/email and password are required/);
    const anna = await ctx.fns.auth.createUser({ name: "Anna", email: "anna@x.test", password: "password-456" });
    expect(anna.id).toBe("anna");
    expect(anna.role).toBe("member");
    expect(await ctx.fns.auth.verifyUser({ password: "password-456" })).toBeNull(); // no email with 2 users
    expect((await ctx.fns.auth.verifyUser({ email: "ANNA@x.test", password: "password-456" }))?.id).toBe("anna");
    await expect(ctx.fns.auth.createUser({ name: "Dup", email: "anna@x.test", password: "password-789" })).rejects.toThrow(/in use/);
});

test("disabling takes effect on the next request; last owner is protected", async () => {
    const ctx = await mkTestCtx();
    const owner = await ctx.fns.auth.createUser({ name: "Nik", email: "nik@x.test", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna", email: "anna@x.test", password: "password-456" });
    const cookie = await cookieFor(ctx, anna);
    expect((await ctx.fns.auth.currentUser({ req: req(cookie) })).user?.id).toBe("anna");
    await ctx.fns.auth.setUserDisabled({ id: anna.id, disabled: true });
    expect((await ctx.fns.auth.currentUser({ req: req(cookie) })).user).toBeNull();
    await expect(ctx.fns.auth.setUserDisabled({ id: owner.id, disabled: true })).rejects.toThrow(/last active owner/);
    await expect(ctx.fns.auth.updateUser({ id: owner.id, role: "member" })).rejects.toThrow(/last active owner/);
});

test("rename keeps the id", async () => {
    const ctx = await mkTestCtx();
    const u = await ctx.fns.auth.createUser({ name: "Nik" });
    const renamed = await ctx.fns.auth.updateUser({ id: u.id, name: "Nikolai" });
    expect(renamed.id).toBe(u.id);
    expect(renamed.name).toBe("Nikolai");
});

test("seed: once from env/legacy password, never overwrites", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_USER: "Nikolai", HYPER_USER_EMAIL: "nik@x.test", HYPER_PASSWORD: "legacy-password" } });
    const seeded = await ctx.fns.auth.seed({});
    expect(seeded?.name).toBe("Nikolai");
    expect(seeded?.configuredAt).not.toBeNull();
    expect((await ctx.fns.auth.verifyUser({ password: "legacy-password" }))?.id).toBe(seeded!.id);
    ctx.env.HYPER_PASSWORD = "changed-in-env";
    expect(await ctx.fns.auth.seed({})).toBeNull();
    expect(await ctx.fns.auth.verifyUser({ password: "changed-in-env" })).toBeNull();
});

test("seed from legacy password only does nothing: switching is explicit", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PASSWORD: "legacy-password" } });
    expect(await ctx.fns.auth.seed({})).toBeNull();
    expect((await ctx.fns.auth.listUsers({})).length).toBe(0);
});

test("code deployed before the switch keeps legacy shared-password sign-in", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PASSWORD: "legacy-password" } });
    const anon = await ctx.fns.auth.currentUser({ req: req() });
    expect(anon).toEqual({ user: null, required: true, legacy: false });
    const token = await ctx.fns.procs.auth.sign({ sub: "password-user", name: "Hyper user", role: "owner", days: 1 });
    const legacy = await ctx.fns.auth.currentUser({ req: req(`${ctx.fns.procs.auth.cookieName({})}=${token}`) });
    expect(legacy.legacy).toBe(true);
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/auth/login", body: { password: "legacy-password" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(ctx.fns.procs.auth.cookieName({}));
    // A stranger cannot claim the install through the web setup.
    const setup = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/auth/setup", body: new URLSearchParams({ name: "Mallory" }) });
    expect(setup.status).toBe(409);
    expect((await ctx.fns.auth.listUsers({})).length).toBe(0);
});

test("after the switch the legacy cookie stops working and the password still signs in", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PASSWORD: "legacy-password" } });
    const token = await ctx.fns.procs.auth.sign({ sub: "password-user", name: "Hyper user", role: "owner", days: 1 });
    await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: await ctx.fns.auth.password({}), role: "owner" });
    const stale = await ctx.fns.auth.currentUser({ req: req(`${ctx.fns.procs.auth.cookieName({})}=${token}`) });
    expect(stale.user).toBeNull();
    expect(stale.required).toBe(true);
    expect((await ctx.fns.auth.verifyUser({ password: "legacy-password" }))?.id).toBe("niquola");
});

test("authorship: agent creator, user message author, event actor", async () => {
    const ctx = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nik" });
    const r: any = reqCtx(ctx);
    r.session.user = nik;
    const agent = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent });
    const [row] = await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [agent.id] });
    expect(row.created_by).toBe("nik");

    await r.fns.session.appendUserMessage({ id: agent.id, text: "hello" });
    const msgs = await ctx.fns.session.getMessages({ id: agent.id });
    expect(msgs.at(-1)?.author).toBe("nik");
    const [ev] = await ctx.fns.procs.db.select({ sql: "SELECT actor FROM events WHERE agent_id = ? ORDER BY idx DESC LIMIT 1", params: [agent.id] });
    expect(ev.actor).toBe("nik");

    // Background (no session user): falls back to the agent's creator.
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "from cron" } });
    const [bg] = await ctx.fns.procs.db.select({ sql: "SELECT author FROM messages WHERE agent_id = ? ORDER BY idx DESC LIMIT 1", params: [agent.id] });
    expect(bg.author).toBe("nik");

    // Assistant rows have no author; a full rewrite keeps authors.
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "assistant", content: "hi" } });
    const loaded = await ctx.fns.session.load({ id: agent.id });
    await ctx.fns.session.save({ agent: loaded! });
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT role, author FROM messages WHERE agent_id = ? ORDER BY idx", params: [agent.id] });
    expect(rows.filter((x: any) => x.role === "user").every((x: any) => x.author === "nik")).toBe(true);
    expect(rows.find((x: any) => x.role === "assistant")?.author).toBeNull();
    const [creator] = await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [agent.id] });
    expect(creator.created_by).toBe("nik");
});

test("legacy session counts as signed in on /auth/session before the switch", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PASSWORD: "legacy-password" } });
    const token = await ctx.fns.procs.auth.sign({ sub: "password-user", name: "Hyper user", role: "owner", days: 1 });
    const cookie = `${ctx.fns.procs.auth.cookieName({})}=${token}`;
    const ok = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).authenticated).toBe(true);
    const anon = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session" });
    expect(anon.status).toBe(401);
});

test("migration converges an older, stricter users table and is idempotent", async () => {
    const ctx = await mkTestCtx();
    const m = (ctx.state.procs.migrate.list as any[]).find((x) => x.id === "20320401000000_users");
    await m.down(ctx);
    // The shape an early draft left in a live database.
    await ctx.fns.procs.db.exec({ sql: `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        disabled_at BIGINT); CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)); ALTER TABLE agents ADD COLUMN created_by TEXT;` });
    await m.up(ctx);
    await m.up(ctx);
    const cols = await ctx.fns.procs.db.select({ sql: "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='users' AND table_schema = current_schema()" });
    const nullable = Object.fromEntries(cols.map((c: any) => [c.column_name, c.is_nullable]));
    expect(nullable.email).toBe("YES");
    expect(nullable.password_hash).toBe("YES");
    expect(nullable.configured_at).toBe("YES");
    // A lone user without email/password is accepted after convergence.
    expect((await ctx.fns.auth.createUser({ name: "Solo" })).id).toBe("solo");
});
