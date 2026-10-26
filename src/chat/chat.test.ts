import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const agentRow = (over: Record<string, any> = {}) => ({ id: "a1", model: "anthropic:claude-opus-4-5", title: "Header test", messages: [], events: [], scratchpad: {}, workspaceDir: "/tmp/proj", workspaceHost: "", systemPrompt: "", parentId: null, ...over });

async function ctxWithAgent(over: Record<string, any> = {}) {
    const ctx: any = await mkTestCtx();
    const agent = agentRow(over);
    ctx.state.agent = { a1: agent };
    ctx.state.registry.session.getMaxEventIdx = () => -1;
    ctx.state.registry.session.getEvents = () => [];
    ctx.state.registry.session.getFullMessages = () => [];
    ctx.state.registry.session.getMessages = () => [];
    return { ctx, agent };
}

describe("chat header parts", () => {
    test("core badges, buttons and cards are registered in their declared order, danger last", async () => {
        const { ctx } = await ctxWithAgent();
        const ids = async (kind: string) => (await ctx.fns.chat.listParts({ kind, layout: {} })).map((p: any) => p.id);
        expect(await ids("badge")).toEqual(["agent.workspace", "agent.parent", "agent.status"]);
        expect(await ids("button")).toEqual(["canvas.toggle", "canvas.collapse", "agent.inspector"]);
        const cards = await ids("card");
        expect(cards[0]).toBe("appearance");
        expect(cards.at(-1)).toBe("danger");
    });

    test("layout reorders and hides parts, skips unknown ids and never hides danger", async () => {
        const { ctx } = await ctxWithAgent();
        ctx.state.chat.parts["x.b"] = { id: "x.b", kind: "button", module: "x", rel: "x", order: 1, render: () => null };
        const layout = { buttons: ["canvas.toggle", "nope.missing"], cards: ["danger", "share"], hidden: ["danger", "agent.work"] };
        expect((await ctx.fns.chat.listParts({ kind: "button", layout })).map((p: any) => p.id)).toEqual(["canvas.toggle", "x.b", "canvas.collapse", "agent.inspector"]);
        expect((await ctx.fns.chat.listParts({ kind: "button", layout: { hidden: ["canvas.toggle"] } })).map((p: any) => p.id)).toEqual(["x.b", "canvas.collapse", "agent.inspector"]);
        const cards = (await ctx.fns.chat.listParts({ kind: "card", layout })).map((p: any) => p.id);
        expect(cards[0]).toBe("share");
        expect(cards).not.toContain("agent.work");
        expect(cards.at(-1)).toBe("danger");
    });

    test("register validates files and namespaces ids by module", async () => {
        const { ctx } = await ctxWithAgent();
        const mod = (def: any) => ({ default: def });
        await ctx.fns.chat.register({ kind: "badge", entries: [{ name: "pr", moduleDir: "gh", rel: "gh/$chatbadge_pr.ts", mod: mod({ order: 5, render: () => null }) }] });
        expect(ctx.state.chat.parts["gh.pr"].kind).toBe("badge");
        await expect(ctx.fns.chat.register({ kind: "card", entries: [{ name: "x", moduleDir: "gh", rel: "gh/$chatcard_x.ts", mod: mod({ render: () => [] }) }] })).rejects.toThrow("needs a title");
        await expect(ctx.fns.chat.register({ kind: "button", entries: [{ name: "Bad", moduleDir: "gh", rel: "gh/$chatbutton_Bad.ts", mod: mod({ render: () => null }) }] })).rejects.toThrow("name must");
    });

    test("header draws icon, name, badges, buttons and the panel trigger; a failing part only hides itself", async () => {
        const { ctx } = await ctxWithAgent();
        ctx.state.registry.agent.renderStatusBar = () => '<span id="status-bar">idle</span>';
        ctx.state.chat.parts["test.boom"] = { id: "test.boom", kind: "badge", module: "test", rel: "x", render: () => { throw new Error("boom"); } };
        ctx.state.chat.parts["test.slow"] = { id: "test.slow", kind: "button", module: "test", rel: "x", render: () => new Promise(() => {}) };
        ctx.state.chat.parts["test.pr"] = { id: "test.pr", kind: "badge", module: "test", rel: "x", order: 1, render: () => ({ icon: "ph-git-pull-request", label: "PR #12", href: "/pr/12" }) };
        const view = await ctx.fns.chat.buildRenderContext({ agentId: "a1" });
        const started = Date.now();
        const html = await ctx.fns.chat.header({ context: view });
        expect(Date.now() - started).toBeLessThan(2500);
        expect(html).toContain('data-chat-part="icon"');
        // The icon opens the chat panel; the model is picked in the composer.
        expect(html).not.toContain('hx-popup="agent.modelPicker"');
        expect(html).toMatch(/popovertarget="chat-panel-a1"[^>]*data-chat-part="icon"|data-chat-part="icon"[^>]*popovertarget="chat-panel-a1"/);
        // Icon + name + chevron are the one trigger of the panel; Rename… lives in the panel's Appearance card.
        expect(html).not.toContain('hx-popup="chat.renamePopup"');
        expect(html).toContain('class="w-pane-header"');
        expect(html).toContain('class="w-disclosure"');
        expect(html).toContain("Header test");
        expect(html).toContain('data-chat-id="agent.workspace"');
        expect(html).toContain("Files · /tmp/proj");
        expect(html).toContain('data-chat-id="canvas.toggle"');
        
        
        expect(html).toContain('popovertarget="chat-panel-a1"');
        expect(html).toContain('data-chat-panel="/chat/a1/panel"');
        expect(html).toContain("PR #12");
        expect(html).not.toContain("test.boom");
        expect(html).not.toContain("test.slow");
        expect(html).not.toContain('data-chat-id="agent.parent"');
    }, 10_000);

    test("parent badge shows on forks", async () => {
        const { ctx } = await ctxWithAgent({ parentId: "p1" });
        ctx.state.agent.p1 = agentRow({ id: "p1", title: "Parent chat" });
        ctx.state.registry.agent.renderStatusBar = () => "";
        const html = await ctx.fns.chat.header({ context: await ctx.fns.chat.buildRenderContext({ agentId: "a1" }) });
        expect(html).toContain('data-chat-id="agent.parent"');
        expect(html).toContain('href="/agent/p1"');
        expect(html).toContain("Parent chat");
    });

    test("panel draws the cards with their rows; danger rows post with confirm", async () => {
        const { ctx } = await ctxWithAgent({ scratchpad: { plan: { title: "Ship it", tasks: [{ id: "a", title: "first", status: "done" }, { id: "b", title: "second", status: "active" }] } } });
        ctx.state.registry.agent.team = () => [];
        ctx.state.registry.ui.automationRows = () => [];
        const html = await ctx.fns.chat.panel({ agentId: "a1" });
        expect(html).toContain('data-chat-id="appearance"');
        expect(html).toContain('hx-popup="chat.iconPopup"');
        expect(html).toContain("Ship it");
        expect(html).toContain("1/2");
        expect(html).toContain('action="/agent/a1/fork"');
        expect(html).toContain('action="/agent/a1/delete"');
        expect(html).toContain("confirm(");
        expect(html).not.toContain('data-chat-id="agent.wakeups"');
        expect(html.lastIndexOf('data-chat-id="danger"')).toBeGreaterThan(html.lastIndexOf('data-chat-id="share"'));
    });

    test("model chip opens the provider picker; context ring is empty before the first answer", async () => {
        const { ctx } = await ctxWithAgent();
        const chip = await ctx.fns.chat.modelChip({ agentId: "a1" });
        expect(chip).toContain('hx-popup="agent.modelPicker"');
        expect(chip).toContain("Opus 4.5");
        expect(await ctx.fns.chat.contextRing({ agentId: "a1" })).toBe("");
    });

    test("icon: running ring around the logo, live ring follows the header status", async () => {
        const ctx: any = await mkTestCtx();
        const running = ctx.fns.w.chatIcon({ model: "anthropic:claude-opus-4-5", active: true });
        expect(running).toContain("w-chat-icon-ring");
        expect(running).not.toContain("animate-spin");
        expect(ctx.fns.w.chatIcon({ model: "anthropic:claude-opus-4-5", live: true, size: "md" })).toContain("data-live");
        expect(ctx.fns.w.chatIcon({ model: "anthropic:claude-opus-4-5" })).not.toContain("w-chat-icon-ring");
    });

    test("GET /chat/:id/panel serves the panel", async () => {
        const { ctx } = await ctxWithAgent();
        ctx.state.registry.agent.team = () => [];
        ctx.state.registry.ui.automationRows = () => [];
        const res = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/chat/a1/panel" });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Danger zone");
    });
});

describe("chat icon", () => {
    test("sanitizeSvg keeps drawing and drops scripts, handlers, foreign content and external refs", async () => {
        const ctx: any = await mkTestCtx();
        const out = ctx.fns.chat.sanitizeSvg({ svg: `<?xml version="1.0"?><svg width="32" height="32" onload="alert(1)"><script>alert(2)</script><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><circle cx="16" cy="16" r="15" fill="url(#g)" onclick="x()"/><image href="https://evil/x.png"/><use href="https://evil/#a"/><use href="#g"/><foreignObject><div>hi</div></foreignObject><rect style="fill:url(https://evil)" width="3" height="3"/><a href="javascript:alert(3)"><text>t</text></a></svg>` });
        expect(out).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
        expect(out).toContain('viewBox="0 0 32 32"');
        expect(out).toContain('fill="url(#g)"');
        expect(out).toContain('<use href="#g"');
        for (const bad of ["script", "onload", "onclick", "evil", "foreignObject", "javascript", "<image", "<a "]) expect(out).not.toContain(bad);
    });

    test("sanitizeSvg rejects non-svg, sizeless and oversized input", async () => {
        const ctx: any = await mkTestCtx();
        expect(() => ctx.fns.chat.sanitizeSvg({ svg: "<div>x</div>" })).toThrow("exactly one <svg>");
        expect(() => ctx.fns.chat.sanitizeSvg({ svg: "<svg><rect/></svg>" })).toThrow("viewBox");
        const big = `<svg viewBox="0 0 1 1">${'<rect width="1" height="1"/>'.repeat(400)}</svg>`;
        expect(() => ctx.fns.chat.sanitizeSvg({ svg: big })).toThrow("larger than");
    });

    test("setIcon stores emoji/svg, icon draws it as an image with a model mark, reset returns the logo", async () => {
        const { ctx } = await ctxWithAgent();
        await ctx.fns.session.save({ agent: ctx.state.agent.a1 });
        const emoji = await ctx.fns.chat.setIcon({ id: "a1", emoji: "🦊", background: "#7c3aed" });
        expect(emoji.icon).toContain("🦊");
        expect(ctx.state.agent.a1.icon).toBe(emoji.icon);
        expect((await ctx.fns.session.load({ id: "a1" })).icon).toBe(emoji.icon);
        const drawn = ctx.fns.w.chatIcon({ icon: emoji.icon, model: "anthropic:claude-opus-4-5", size: "md" });
        expect(drawn).toContain('<img src="data:image/svg+xml,');
        expect(drawn).toContain("w-chat-icon");
        await expect(ctx.fns.chat.setIcon({ id: "a1", emoji: "x", background: "red;}" })).rejects.toThrow("CSS colour");
        await expect(ctx.fns.chat.setIcon({ id: "a1" })).rejects.toThrow("exactly one");
        const svg = await ctx.fns.chat.setIcon({ id: "a1", svg: '<svg viewBox="0 0 8 8"><rect width="8" height="8" onclick="x"/></svg>' });
        expect(svg.icon).not.toContain("onclick");
        expect((await ctx.fns.chat.setIcon({ id: "a1", reset: true })).icon).toBeNull();
        expect(ctx.fns.w.chatIcon({ icon: null, model: "anthropic:claude-opus-4-5" })).not.toContain("<img");
    });

    test("saveAvatar reports a bad SVG inside the editor instead of failing", async () => {
        const { ctx } = await ctxWithAgent();
        await ctx.fns.session.save({ agent: ctx.state.agent.a1 });
        const res = await ctx.fns.chat.saveIcon({ agentId: "a1", svg: "<div/>" });
        expect(await res.text()).toContain("exactly one &lt;svg&gt;");
        const ok = await ctx.fns.chat.saveIcon({ agentId: "a1", emoji: "HC" });
        expect(ok.headers.get("HX-Refresh")).toBe("true");
    });
});
