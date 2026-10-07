import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

async function people(ctx: any) {
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai Ryzhikov", email: "niquola@health-samurai.io", password: "password-123" });
    const anna = await ctx.fns.auth.createUser({ name: "Anna K", email: "anna@health-samurai.io", password: "password-456" });
    const as = (user: any) => { const r: any = reqCtx(ctx); r.session.user = user; return r; };
    // A signed-in browser request of this person (pages go through the auth middleware).
    const get = async (user: any, path: string) => {
        const cookie = `${ctx.fns.procs.auth.cookieName({})}=` + await ctx.fns.procs.auth.sign({ sub: user.id, name: user.name, role: user.role, days: 1 });
        return ctx.fns.procs.http.dispatch({ method: "GET", url: `http://localhost${path}`, headers: { cookie } });
    };
    return { nik, anna, rn: as(nik), ra: as(anna), get };
}

test("a person's @id in a message becomes an unread mention for them; opening the chat reads it", async () => {
    const ctx: any = await mkTestCtx();
    const { nik, anna, rn, ra, get } = await people(ctx);
    expect(nik.id).toBe("niquola");
    expect(anna.id).toBe("anna");
    const agent = await rn.fns.agent.start({ model: "mock:echo" });
    await rn.fns.session.save({ agent });

    // Typed by Nikolai: Anna is mentioned once (repeat ignored), an email and an unknown @word are not mentions,
    // and his own @id does not notify him.
    const { idx } = await rn.fns.session.appendUserMessage({ id: agent.id, text: "@anna look at this, @anna! mail anna@health-samurai.io, cc @nobody and @niquola" });
    expect(await ctx.fns.mentions.unreadCount({ userId: "anna" })).toBe(1);
    expect(await ctx.fns.mentions.unreadCount({ userId: "niquola" })).toBe(0);
    const [m] = await ra.fns.mentions.list({ unreadOnly: true });
    expect(m).toMatchObject({ agentId: agent.id, messageIdx: idx, from: "niquola", readAt: null });
    expect(m.excerpt).toStartWith("@anna look at this");

    // An agent's reply mentions too, authored by the agent.
    const reply = await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "assistant", content: "Done. @niquola, @anna please review." } });
    expect((await ra.fns.mentions.list({ unreadOnly: true })).map((x: any) => x.messageIdx)).toEqual([reply.idx, idx]);
    expect((await rn.fns.mentions.list({}))[0]).toMatchObject({ from: `agent:${agent.id}`, messageIdx: reply.idx });

    // Context rows (status line, world state) never mention anyone.
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "## People\n@anna", message_type: "world_state", excluded_from_cursor: true } });
    expect(await ctx.fns.mentions.unreadCount({ userId: "anna" })).toBe(2);

    // The rail badge and the global menu show Anna's unread mentions, with links to the message.
    const badge = await ra.fns.mentions.badge({});
    expect(badge).toContain('data-me="anna"');
    expect(badge).toContain("2 unread mentions");
    expect(badge).toContain(`/agent/${agent.id}#m-${idx}`);
    const menu = await (await get(anna, "/nav/items")).text();
    expect(menu).toContain("Mentions · 2");
    expect(menu).toContain(`/agent/${agent.id}#m-${reply.idx}`);

    // Opening the chat (markSeen) reads Anna's mentions there — and only hers.
    await ra.fns.auth.markSeen({ agentId: agent.id });
    expect(await ctx.fns.mentions.unreadCount({ userId: "anna" })).toBe(0);
    expect(await ctx.fns.mentions.unreadCount({ userId: "niquola" })).toBe(1);
    expect(await ra.fns.mentions.badge({})).not.toContain("unread");
    // The live refresh route answers the same badge for the signed-in person.
    expect(await (await get(nik, "/mentions/badge")).text()).toContain("1 unread mention");
});

test("mentions render as chips with the person's name, never inside code", async () => {
    const ctx: any = await mkTestCtx();
    await people(ctx);
    const html = await ctx.fns.mentions.highlight({ html: "<p>hi @anna and @ghost</p><pre><code>@anna</code></pre><a href=\"mailto:x@anna.io\">x@anna.io</a>" });
    expect(html).toContain('<span class="rounded bg-primary/10 px-0.5 font-semibold text-primary" data-mention="anna" title="Anna K">@anna</span>');
    expect(html).toContain("@ghost");
    expect(html).toContain("<pre><code>@anna</code></pre>");
    expect(html).toContain("x@anna.io</a>");
    expect((html.match(/data-mention/g) ?? []).length).toBe(1);
});

test("the composer asks /mentions/people; the agent learns whom it can mention on a shared Hyper", async () => {
    const ctx: any = await mkTestCtx();
    const { anna, get } = await people(ctx);
    const res = await get(anna, "/mentions/people");
    expect((await res.json()).map((p: any) => p.id)).toEqual(["niquola", "anna"]);
    const blocks = await ctx.fns.procs.hooks.run({ name: "agent.promptAugment", opts: { agentId: "x", text: "hi" } });
    expect(blocks.join("\n")).toContain("- @anna — Anna K <anna@health-samurai.io>");
});
