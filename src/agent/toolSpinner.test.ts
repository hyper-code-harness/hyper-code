import { describe, expect, it } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

const arcLength = (html: string) => Number(/stroke-dasharray="([\d.]+) 97.4"/.exec(html)?.[1]);

describe("agent.toolSpinner", () => {
    it("carries start and deadline so the browser can keep the arc growing", () => {
        const started = 1_700_000_000_000;
        const html = ctx.fns.agent.toolSpinner({ icon: "terminal", startedAt: started, timeoutMs: 120_000 });

        expect(html).toContain(`data-tool-started-at="${started}"`);
        expect(html).toContain(`data-tool-deadline="${started + 120_000}"`);
        expect(html).toContain("ph-terminal");
    });

    it("is one turning arc, not a spinner plus a separate progress ring", () => {
        // Two shapes said the same thing twice and could drift apart; the
        // length of the moving arc IS the progress.
        const html = ctx.fns.agent.toolSpinner({ icon: "terminal", startedAt: Date.now(), timeoutMs: 60_000 });

        expect(html.match(/animate-spin/g)?.length).toBe(1);
        expect(html.match(/tool-progress/g)?.length).toBe(1);
        expect(html).toContain("tool-progress animate-spin");
    });

    it("renders the arc already at its true length, not at zero", () => {
        // The live region replaces this markup every few seconds. An arc that
        // always arrived empty would snap back to nothing on every poll and
        // creep forward again, reading as the work restarting.
        const html = ctx.fns.agent.toolSpinner({ icon: "terminal", startedAt: Date.now() - 60_000, timeoutMs: 120_000 });

        expect(arcLength(html)).toBeGreaterThan(97.4 * 0.45);
        expect(arcLength(html)).toBeLessThan(97.4 * 0.55);
    });

    it("stays visible in the first seconds, when the true length rounds to a dot", () => {
        // Its first job is to say "running"; an invisible arc fails that before
        // it gets a chance to say how far along the call is.
        const html = ctx.fns.agent.toolSpinner({ icon: "terminal", startedAt: Date.now(), timeoutMs: 1_800_000 });

        expect(arcLength(html)).toBeGreaterThan(5);
    });

    it("clamps a call that outlived its timeout to a closed ring", () => {
        // Past the limit the tool is in the kill path. An arc that kept growing
        // would claim more time was allowed than there is.
        const html = ctx.fns.agent.toolSpinner({ icon: "terminal", startedAt: Date.now() - 600_000, timeoutMs: 60_000 });

        expect(arcLength(html)).toBe(97.4);
    });

    it("without a timeout turns at a constant length, showing liveness only", () => {
        // There is no limit to measure against, so a growing arc would be a
        // guess presented as a fact.
        const html = ctx.fns.agent.toolSpinner({ icon: "code", startedAt: Date.now() });

        expect(html).not.toContain("data-tool-deadline");
        expect(html).toContain("animate-spin");
        expect(arcLength(html)).toBe(26);
    });

    it("escapes the icon name into the class", () => {
        const html = ctx.fns.agent.toolSpinner({ icon: '"><script>', startedAt: Date.now() });

        expect(html).not.toContain("<script>");
    });
});
