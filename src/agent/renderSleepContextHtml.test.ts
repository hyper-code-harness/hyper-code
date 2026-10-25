import { describe, expect, test } from "bun:test";
import renderSleepContextHtml from "./renderSleepContextHtml";
import renderEventHtml from "./renderEventHtml";
import renderEventsHtml from "./renderEventsHtml";

describe("renderSleepContextHtml", () => {
    test("shows synthetic consolidation and only the visible real tail", async () => {
        const errors: string[] = [];
        const ctx: any = { fns: { agent: {}, procs: { ui: { escape: ({ text }: any) => String(text), button: (o: any) => `<button>${o.html ?? ""}</button>` }, log: { warn: (o: any) => errors.push(o.msg) } }, w: { escape: ({ text }: any) => String(text), button: (o: any) => `<button>${o.html ?? ""}</button>` } } };
        ctx.fns.agent.renderEventHtml = (opts: any) => renderEventHtml(ctx, null, opts);
        ctx.fns.agent.renderEventsHtml = (opts: any) => renderEventsHtml(ctx, null, opts);
        ctx.fns.agent.normalizeSleepContext = ({ sleepContext }: any) => sleepContext;
        ctx.fns.agent.getSleepGeneration = ({ sleepContext }: any) => sleepContext.generations.find((x: any) => x.revision === sleepContext.activeRevision);
        const html = await renderSleepContextHtml(ctx, null, {
            agentId: "a1",
            sleepContext: {
                mode: "compact", activeRevision: 1, draftRevision: null,
                generations: [{ revision: 1, sourceOffset: 10, tailStart: 7,
                  contextMessages: [{ role: "user", content: "# Consolidated session\n\nkept fact", message_type: "consolidated_session" }] }],
            },
            events: [
                { type: "user", text: "hidden old", messageIdx: 2 },
                { type: "user", text: "visible recent", messageIdx: 7 },
            ],
        });
        expect(html).toContain("Compact context active");
        expect(html).toContain("kept fact");
        expect(html).toContain("visible recent");
        expect(html).not.toContain("hidden old");
        expect(errors).toEqual([]);   // every event rendered, none fell back to an error card
        expect(html).not.toContain(`hx-vals='{\"idx\":\"0\"`);
    });

    test("renders nothing when compact context is inactive", async () => {
        const ctx: any = { fns: { agent: { normalizeSleepContext: ({ sleepContext }: any) => sleepContext, getSleepGeneration: () => null } } };
        const html = await renderSleepContextHtml(ctx, null, { agentId: "a1", sleepContext: { mode: "full", activeRevision: null, draftRevision: null, generations: [] }, events: [] });
        expect(html).toBe("");
    });
});
