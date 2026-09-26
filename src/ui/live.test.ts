import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("ui.live", () => {
    test("a region declares where to refetch and which topic to watch — and nothing else", async () => {
        const ctx: any = await mkTestCtx();
        const html = ctx.fns.ui.live({ id: "status", url: "/agent/a/statusbar", topic: "agent:a", html: "idle" });

        expect(html).toContain('id="status"');
        expect(html).toContain('hx-get="/agent/a/statusbar"');
        expect(html).toContain('data-live-topic="agent:a"');
        expect(html).toContain(">idle</div>");
        // No cursor: state kept on both sides is state that can disagree, and
        // that disagreement is what turned an idle page into a refetch loop.
        expect(html).not.toContain("data-live-cursor");
    });

    test("supports non-div regions, inner swaps and one additional trigger", async () => {
        const ctx: any = await mkTestCtx();
        const html = ctx.fns.ui.live({
            id: "agents", url: "/ui/rail", topic: "agents", tag: "nav",
            swap: "innerHTML", trigger: "load", every: 60, attrs: 'class="rail"',
        });
        expect(html).toStartWith('<nav id="agents"');
        expect(html).toContain('hx-trigger="load, hyper-live, every 60s"');
        expect(html).toContain('hx-swap="innerHTML"');
        expect(html).toContain('class="rail"');
        expect(html).toEndWith('</nav>');
    });


    test("the timer is a watchdog, never the mechanism", async () => {
        const ctx: any = await mkTestCtx();
        const html = ctx.fns.ui.live({ id: "x", url: "/x", topic: "t" });

        expect(html).toContain('hx-trigger="hyper-live, every');
        expect(html).toContain("every 30s");
        // Nobody may ask for a hot loop.
        expect(ctx.fns.ui.live({ id: "x", url: "/x", topic: "t", every: 1 })).toContain("every 5s");
    });

    test("editable regions refresh only from their topic", async () => {
        const ctx: any = await mkTestCtx();
        const html = ctx.fns.ui.live({ id: "meta", url: "/meta", topic: "agent-meta:a", every: 0 });
        expect(html).toContain('data-live-topic="agent-meta:a"');
        expect(html).toContain('hx-trigger="hyper-live"');
        expect(html).not.toContain("every 5s");
    });


    // A live region sits inside pages that declare hx-target for their own
    // links; without saying "this" it inherits that target and the refresh
    // paints the region over the page containing it.
    test("a region refreshes itself, whatever its ancestors say", async () => {
        const ctx: any = await mkTestCtx();

        expect(ctx.fns.ui.live({ id: "x", url: "/x", topic: "t" })).toContain('hx-target="this"');
        // A caller may still aim it somewhere else, and only its target survives.
        const aimed = ctx.fns.ui.live({ id: "x", url: "/x", topic: "t", attrs: 'hx-target="#other"' });
        expect(aimed).toContain('hx-target="#other"');
        expect(aimed).not.toContain('hx-target="this"');
    });
});
