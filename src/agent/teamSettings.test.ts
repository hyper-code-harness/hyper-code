import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import team from "./team";
import renderSection from "../ui/agentMetaSection";
import renderPanel from "../ui/agentMetaPanel";

describe("delegated team settings", () => {
    test("projects durable model and requested effort for active and archived children", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "parent-model" });
        const child = await ctx.fns.session.fork({ id: parent.id, title: "Child", offset: 0 });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET visibility = 'team', model = ?, reasoning_effort = ? WHERE id = ?", params: ["provider:child-model", "xhigh", child.id] });
        // Projection must read durable preferences, not the live parent's settings or applied effort.
        const active = await team(ctx, null, { agent: parent });
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({ id: child.id, model: "provider:child-model", reasoningEffort: "xhigh" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET archived_at = ? WHERE id = ?", params: [123, child.id] });
        expect(await team(ctx, null, { agent: parent })).toEqual([]);
        expect((await team(ctx, null, { agent: parent, includeArchived: true }))[0]).toMatchObject({ model: "provider:child-model", reasoningEffort: "xhigh", archivedAt: 123 });
    });

    test("legacy rows without reasoning effort project auto", async () => {
        const ctx = await mkTestCtx();
        ctx.fns.procs.db.select = async () => [{ id: "child", model: "provider:model", scratchpad: "{}", reasoning_effort: null }];
        const members = await team(ctx, null, { agent: { id: "parent" } as any });
        expect(members[0]).toMatchObject({ model: "provider:model", reasoningEffort: "auto" });
    });

    test("Team Meta escapes models and requested effort for active and archived children", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "parent-model" });
        const model = '<img src=x onerror="alert(1)">';
        const effort = '<script>alert(2)</script>';
        const member = { id: "child", title: "Child", model, reasoningEffort: effort as any, runState: "idle", status: "ready", plan: null, summary: null, updatedAt: 0 };
        for (const members of [{ team: [member] }, { archivedTeam: [member] }]) {
            const html = renderSection(ctx, null, { agent: parent, section: "team", ...members });
            expect(html).toContain('data-team-member-settings');
            expect(html).toContain('Reasoning (requested):');
            expect(html).toContain(ctx.fns.w.escape({ text: model }));
            expect(html).toContain(ctx.fns.w.escape({ text: effort }));
            expect(html).not.toContain(model);
            expect(html).not.toContain(effort);
        }
    });

    test("full Meta panel forwards settings and displays auto for older callers", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "parent-model" });
        ctx.fns.ui.agentMetaSection = renderSection;
        const member = { id: "child", title: "Child", model: "provider:model", runState: "idle", status: "ready", plan: null, summary: null, updatedAt: 0 };
        const html = renderPanel(ctx, null, { agent: parent, team: [member] });
        expect(html).toContain('provider:model');
        expect(html).toContain('Reasoning (requested): <span>auto</span>');
    });
});
