import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import route from "./$route_$id_wake_POST";

test("wake preset overrides the custom minutes input", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const before = Date.now();
    const req = new Request(`http://test/agent/${agent.id}/wake`, {
        method: "POST",
        body: new URLSearchParams({ action: "set", reason: "one hour", minutes: "5", preset: "60" }),
    });
    const response = await route(ctx, null, { req, params: { id: agent.id } });
    expect(response.status).toBe(204);
    // agent.wake records a one-shot trigger; the preset (60) wins over minutes (5)
    const [trigger] = await ctx.fns.agent.triggers({ id: agent.id });
    expect(trigger.prompt).toBe("one hour");
    expect(Number(trigger.nextAt)).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(Number(trigger.nextAt)).toBeLessThan(before + 61 * 60_000);
});
