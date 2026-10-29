import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

// Pinned tabs, drag-and-drop order and tidying of a long strip, end to end through the HTTP route
// canvas.js uses, the panel html and the canvas functions.
const setup = async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    const open = async (n: string) => (await ctx.fns.canvas.show({ agentId: a.id, kind: "html", args: { html: `<p>${n}</p>` }, title: n })).id as number;
    const post = (body: unknown) => ctx.fns.procs.http.dispatch({ method: "POST", url: `http://localhost/canvas/${a.id}`, headers: { "content-type": "application/json", "x-canvas-panel": "1" }, body: JSON.stringify(body) });
    const titles = async () => (await ctx.fns.canvas.list({ agentId: a.id })).map((i: any) => (i.pinned ? "*" : "") + i.title);
    return { ctx, a, open, post, titles };
};

test("pinning moves a tab to the left group; new tabs open right of the pinned ones", async () => {
    const { ctx, a, open, titles } = await setup();
    const one = await open("one"); await open("two"); const three = await open("three");
    expect(await titles()).toEqual(["three", "two", "one"]);           // a new tab opens at the left
    await ctx.fns.canvas.pin({ agentId: a.id, itemId: one });
    expect(await titles()).toEqual(["*one", "three", "two"]);
    await ctx.fns.canvas.pin({ agentId: a.id, itemId: three });
    expect(await titles()).toEqual(["*one", "*three", "two"]);          // pinned in the order they were pinned
    await open("four");
    expect(await titles()).toEqual(["*one", "*three", "four", "two"]);  // the newest stays right of the pins
    await ctx.fns.canvas.pin({ agentId: a.id, itemId: one, pinned: false });
    expect(await titles()).toEqual(["*three", "one", "four", "two"]);
    await expect(ctx.fns.canvas.pin({ agentId: a.id, itemId: 999999 })).rejects.toThrow(/no open tab/);
});

test("move puts a tab in front of another or at the end; the place decides pinned", async () => {
    const { ctx, a, open, titles } = await setup();
    const one = await open("one"); const two = await open("two"); const three = await open("three");
    await ctx.fns.canvas.move({ agentId: a.id, itemId: three });                 // to the end
    expect(await titles()).toEqual(["two", "one", "three"]);
    await ctx.fns.canvas.move({ agentId: a.id, itemId: one, before: two });
    expect(await titles()).toEqual(["one", "two", "three"]);
    await ctx.fns.canvas.pin({ agentId: a.id, itemId: two });
    expect(await titles()).toEqual(["*two", "one", "three"]);
    await ctx.fns.canvas.move({ agentId: a.id, itemId: three, before: two });    // dropped among the pins → pinned
    expect(await titles()).toEqual(["*three", "*two", "one"]);
    await ctx.fns.canvas.move({ agentId: a.id, itemId: two });                   // dragged out to the end → unpinned
    expect(await titles()).toEqual(["*three", "one", "two"]);
    await ctx.fns.canvas.move({ agentId: a.id, itemId: one, before: null, pinned: true }); // forced: last of the pins
    expect(await titles()).toEqual(["*three", "*one", "two"]);
    await expect(ctx.fns.canvas.move({ agentId: a.id, itemId: one, before: 999999 })).rejects.toThrow(/to move in front of/);
});

test("the browser route pins, moves and runs the tab menu; pinned tabs are icons, draggable, without close", async () => {
    const { ctx, a, open, post, titles } = await setup();
    const one = await open("one"); const two = await open("two");
    let res = await post({ pin: { itemId: one, pinned: true } });
    expect(res.status).toBe(200);
    let panel = String((await res.json()).panel);
    expect(await titles()).toEqual(["*one", "two"]);
    const pinnedTab = panel.match(/<span class="w-tab"[^>]*data-pinned[^>]*>.*?<\/span><\/span>|<span class="w-tab"[^>]*data-pinned[^>]*>(?:(?!<span class="w-tab").)*/s)?.[0] ?? "";
    expect(pinnedTab).toContain(`data-canvas-tab="${one}"`);
    expect(pinnedTab).toContain('<span class="w-tab-label" data-short>On</span>');   // two letters, not the title
    expect(pinnedTab).toContain('aria-label="one"');                  // the icon-only tab keeps its name
    expect(pinnedTab).not.toContain("data-canvas-close-item");
    expect(panel).toContain('data-draggable');
    expect(panel).toContain('draggable="true"');
    // Right-click menus as in Chrome: one per tab, Unpin on the pinned one, Pin on the other.
    expect(panel).toContain(`id="canvas-tab-menu-${one}"`);
    expect(panel).toContain(`data-context-of="[data-canvas-header] .w-tab:has(&gt; [data-canvas-tab=&quot;${one}&quot;])"`);
    const menuOf = (id: number) => panel.slice(panel.indexOf(`id="canvas-tab-menu-${id}"`)).split("</div>")[0]!;
    expect(menuOf(one)).toContain(">Unpin<");
    expect(menuOf(two)).toContain(">Pin<");
    res = await post({ move: { itemId: two, before: one } });
    expect(res.status).toBe(200);
    expect(await titles()).toEqual(["*two", "*one"]);
    expect((await post({ move: { itemId: "x" } })).status).toBe(400);
    // The menu items post forms (htmx): unpin, close others / to the right keep pinned tabs.
    const form = (vals: Record<string, string>) => ctx.fns.procs.http.dispatch({ method: "POST", url: `http://localhost/canvas/${a.id}`, headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" }, body: new URLSearchParams(vals).toString() });
    expect((await form({ tabOp: "unpin", itemId: String(one) })).status).toBe(204);
    expect(await titles()).toEqual(["*two", "one"]);
    const three = await open("three"); await open("four");
    expect(await titles()).toEqual(["*two", "four", "three", "one"]);
    await form({ tabOp: "closeRight", itemId: String(three) });
    expect(await titles()).toEqual(["*two", "four", "three"]);
    await form({ tabOp: "closeOthers", itemId: String(three) });
    expect(await titles()).toEqual(["*two", "three"]);
    expect((await ctx.fns.canvas.get({ agentId: a.id })).activeItemId).toBe(three);
    await form({ tabOp: "close", itemId: String(three) });
    expect(await titles()).toEqual(["*two"]);
    expect((await form({ tabOp: "explode", itemId: String(two) })).status).toBe(400);
    expect((await post({ pin: { itemId: 999999 } })).status).toBe(404);
    void a;
});

test("a long strip puts away the least recently shown unpinned tabs, never pinned or active ones", async () => {
    const { ctx, a, open, titles } = await setup();
    await ctx.fns.settings.set({ module: "canvas", scopeType: "global", key: "maxTabs", value: 3 });
    try {
        const one = await open("one"); await open("two");
        await ctx.fns.canvas.pin({ agentId: a.id, itemId: one });
        await open("three"); await open("four");
        expect(await titles()).toEqual(["*one", "four", "three", "two"]);     // 3 unpinned + the pinned one
        const two = (await ctx.fns.canvas.list({ agentId: a.id })).find((i: any) => i.title === "two").id;
        await ctx.fns.canvas.update({ agentId: a.id, activeItemId: two });     // looked at again: now the freshest
        await open("five");
        expect(await titles()).toEqual(["*one", "five", "four", "two"]);      // three was shown least recently
        const closed = (await ctx.fns.canvas.list({ agentId: a.id, closed: true })).map((i: any) => i.title);
        expect(closed).toContain("three");                                     // put away, not deleted
        await ctx.fns.settings.set({ module: "canvas", scopeType: "global", key: "maxTabs", value: 0 });
        await open("six"); await open("seven");
        expect((await titles()).length).toBe(6);                                // 0 turns it off
    } finally {
        await ctx.fns.settings.set({ module: "canvas", scopeType: "global", key: "maxTabs", value: 12 });
    }
});
