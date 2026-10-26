import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry.ts";

describe("agent.renderEventsHtml", () => {
    // The renderer is edited while the server runs: a card can call a helper
    // that only lands a minute later, and rows keep whatever shape they were
    // written with. One bad bubble must cost one bubble.
    test("a failing event does not take the transcript down", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.registry.agent.renderEventHtml = (_c: any, _s: any, opts: any) => {
            if (opts.event.idx === 2) throw new Error("ui.popup is not a function");
            return `<p>event ${opts.event.idx}</p>`;
        };

        const html = await ctx.fns.agent.renderEventsHtml({
            agentId: "a1",
            events: [{ idx: 1 }, { idx: 2 }, { idx: 3 }],
        });

        expect(html).toContain("<p>event 1</p>");
        expect(html).toContain("<p>event 3</p>");
        expect(html).toContain("could not be rendered (#2)");
        expect(html).toContain("ui.popup is not a function");
    });

    // A run of tool calls is one w.toolGroup row drawn on the server, not cells glued together in the browser.
    test("consecutive tool calls are one row; the live tail continues and closes the row on screen", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.registry.agent.renderEventHtml = (_c: any, _s: any, opts: any) => `<p>event ${opts.event.idx}</p>`;
        const call = (idx: number) => ({ type: "tool_call", name: "bash", args: { command: "ls" }, idx });
        const html = await ctx.fns.agent.renderEventsHtml({
            agentId: "a1",
            events: [call(1), { type: "job", idx: 2 }, call(3), { type: "assistant", idx: 4 }, call(5)],
        });
        expect(html.match(/class="w-tool-group"/g)!.length).toBe(2);
        expect(html).toContain('id="tools-1"');
        expect(html).toContain('id="tools-5"');
        expect(html.match(/class="w-tool"/g)!.length).toBe(3);

        // The tail starts with more calls: the row on screen (tools-1) is redrawn out of band with all of them.
        const more = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [call(3)], continueRun: [call(1), call(2)], live: true });
        expect(more).toContain('id="tools-1" class="chat-tools" hx-swap-oob="outerHTML"');
        expect(more.match(/class="w-tool"/g)!.length).toBe(3);

        // The tail starts with text: the row on screen is redrawn (without a running call) and the text follows.
        const text = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "assistant", idx: 3 }], continueRun: [call(1)], live: true });
        expect(text).toContain('id="tools-1" class="chat-tools" hx-swap-oob="outerHTML"');
        expect(text).toContain("<p>event 3</p>");

        // An older page that ends mid-run absorbs the row below it and deletes that row.
        const page = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "user", idx: 0 }, call(1)], joinRun: [call(2)] });
        expect(page).toContain('id="tools-1"');
        expect(page).toContain('<div id="tools-2" hx-swap-oob="delete"></div>');
    });

    test("the running call is the last cell of the last row, or a row of its own", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.registry.agent.renderEventHtml = (_c: any, _s: any, opts: any) => `<p>event ${opts.event.idx}</p>`;
        ctx.state.registry.tools.runs = () => [{ name: "bash", subject: "sleep 9", icon: "ph-terminal-window", startedAt: 1000, agentId: "a1" }];
        const row = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "tool_call", name: "read", args: { path: "a" }, idx: 1 }], live: true });
        expect(row).toContain("data-running");
        expect(row).toContain('class="w-timer" data-since="1000"');
        expect(row).toContain('hx-popup="agent.activeToolDetails"');
        const alone = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "assistant", idx: 1 }], live: true });
        expect(alone).toContain('id="tools-live"');
        const idle = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "assistant", idx: 1 }] });
        expect(idle).not.toContain("data-running");
    });
});
