import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

// Two people on one Hyper: everything "unread" — @mentions (badge, popup, menu widget, mobile API) and the unread
// dot of a chat (session.list, agent.search, nav, dock pins, mobile) — is the signed-in person's own. Each page is
// asked over HTTP with that person's cookie, the way the browser asks it.
test("user A never sees B's mentions or unread state, and reading a chat reads it only for the reader", async () => {
    const ctx: any = await mkTestCtx();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna K", email: "anna@health-samurai.io", password: "password-456" });
    const as = (user: any) => { const r: any = reqCtx(ctx); r.session.user = user; return r; };
    const rn = as(nik), ra = as(anna);
    const http = async (user: any, method: string, path: string) => {
        const cookie = `${ctx.fns.procs.auth.cookieName({})}=` + await ctx.fns.procs.auth.sign({ sub: user.id, name: user.name, role: user.role, days: 1 });
        const res = await ctx.fns.procs.http.dispatch({ method, url: `http://localhost${path}`, headers: { cookie } });
        return { status: res.status, text: await res.text() };
    };

    const chat = await rn.fns.agent.start({ model: "mock:echo" });
    chat.title = "Shared chat"; await rn.fns.session.save({ agent: chat });
    await rn.fns.session.appendUserMessage({ id: chat.id, text: "@anna please look" });
    await ctx.fns.session.appendMessage({ id: chat.id, message: { role: "assistant", content: "Answer for everyone" } });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET last_notifiable_at = ? WHERE id = ?", params: [1, chat.id] });

    // Mentions: Anna has one, Nikolai none — through functions and every page that shows them.
    expect(await ra.fns.mentions.unreadByAgent({})).toEqual({ [chat.id]: 1 });
    expect(await rn.fns.mentions.unreadByAgent({})).toEqual({});
    const badge = { anna: await http(anna, "GET", "/mentions/badge"), nik: await http(nik, "GET", "/mentions/badge") };
    expect(badge.anna.text).toContain("1 unread mention");
    expect(badge.anna.text).toContain('data-me="anna"');
    expect(badge.nik.text).not.toContain("unread mention");
    expect(badge.nik.text).toContain('data-me="niquola"');

    // The shared legacy watermarks (one per chat, written before read state was per person) do not read the
    // chat for anyone on a multi-user Hyper.
    const last = (await ctx.fns.procs.db.select({ sql: "SELECT MAX(idx) AS i FROM messages WHERE agent_id = ?", params: [chat.id] }))[0].i;
    await ctx.fns.procs.db.run({ sql: "INSERT INTO kv (key, value) VALUES (?, ?), (?, ?)", params: [`seen:${chat.id}`, String(last), `seen-at:${chat.id}`, String(Date.now() + 1e9)] });
    // Unread dot: both have not read the chat yet. Nikolai opens it; only his dot goes.
    await rn.fns.auth.markSeen({ agentId: chat.id });
    const unreadOf = async (r: any) => (await r.fns.session.list({})).find((a: any) => a.id === chat.id)?.unread;
    expect(await unreadOf(ra)).toBe(1);
    expect(await unreadOf(rn)).toBe(0);
    const searchOf = async (r: any) => (await r.fns.agent.search({ query: "Shared", limit: 5 })).find((a: any) => a.id === chat.id)?.hasUnread;
    expect(await searchOf(ra)).toBe(true);
    expect(await searchOf(rn)).toBe(false);
    const mobile = async (user: any) => JSON.parse((await http(user, "GET", "/api/mobile/v1/agents")).text).agents.find((a: any) => a.id === chat.id);
    expect(await mobile(anna)).toMatchObject({ unread: 1, mentions: 1 });
    expect(await mobile(nik)).toMatchObject({ unread: 0, mentions: 0 });

    // The menu (⌘/) and the rail, each drawn twice in a row for the two people: no cached tile crosses over.
    for (const round of [1, 2]) {
        const menuAnna = (await http(anna, "GET", "/nav/items")).text;
        const menuNik = (await http(nik, "GET", "/nav/items")).text;
        expect({ round, anna: menuAnna.includes("please look") }).toEqual({ round, anna: true });     // her mention row
        expect({ round, nik: menuNik.includes("please look") }).toEqual({ round, nik: false });
        const dockAnna = (await http(anna, "GET", "/dock")).text;
        const dockNik = (await http(nik, "GET", "/dock")).text;
        expect({ round, anna: dockAnna.includes("unread mention") }).toEqual({ round, anna: true });
        expect({ round, nik: dockNik.includes("unread mention") }).toEqual({ round, nik: false });
    }

    // Anna opens the chat: her mention and dot are read, Nikolai's state does not move.
    await ra.fns.auth.markSeen({ agentId: chat.id });
    expect(await ra.fns.mentions.unreadByAgent({})).toEqual({});
    expect(await unreadOf(ra)).toBe(0);
    expect(await unreadOf(rn)).toBe(0);
});
