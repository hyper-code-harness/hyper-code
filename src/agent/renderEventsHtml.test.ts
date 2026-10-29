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

    // The turn line: a "thinking" cell for the model's time before a call, a glowing one while nothing runs yet,
    // and the turn's overall clock at the end of the live row.
    test("thinking cells and the turn clock", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.registry.agent.renderEventHtml = (_c: any, _s: any, opts: any) => `<p>event ${opts.event.idx}</p>`;
        ctx.state.registry.tools.runs = () => [];
        const db = ctx.state.registry.procs.db.select;
        let started: number | null = 7000;
        ctx.state.registry.procs.db.select = async (c: any, s: any, o: any) => /run_started_at FROM agents/.test(o.sql) ? (started ? [{ run_started_at: started }] : []) : db(c, s, o);

        // The turn just started: no call yet — an empty row with one glowing brain and the overall clock.
        const start = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [{ type: "user", idx: 1 }], live: true });
        expect(start).toContain('id="tools-live"');
        expect(start).toMatch(/class="w-tool" data-running title="thinking"/);
        expect(start).toContain('class="w-timer" data-since="7000"');

        // A call that took the model 3s to decide gets a thinking cell before it; under 1s none.
        const call = (idx: number, thinkMs?: number) => ({ type: "tool_call", name: "bash", args: { command: "ls" }, idx, thinkMs });
        const row = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [call(2, 3000), call(3, 200)], live: true });
        expect(row).toContain('title="thought 3s"');
        expect(row.match(/title="thought/g)!.length).toBe(1);
        expect(row).toContain('data-since="7000"');

        // The turn is over: no clock, no glowing cell, and the turn event draws the total.
        started = null;
        const done = await ctx.fns.agent.renderEventsHtml({ agentId: "a1", events: [call(2, 3000)], live: true });
        expect(done).not.toContain("data-running");
        expect(done).not.toContain("w-timer");
        delete ctx.state.registry.agent.renderEventHtml;
    });
});
