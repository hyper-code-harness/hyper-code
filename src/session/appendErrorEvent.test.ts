import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("a stop by the person is not recorded as an error; a real error is", async () => {
    const ctx: any = await mkTestCtx();
    const a = await ctx.fns.agent.start({ model: "mock:echo" });
    for (const error of ["stopped_by_user", "stopped by user", "AbortError: aborted", "This operation was aborted"])
        expect(await ctx.fns.session.appendErrorEvent({ id: a.id, error })).toBeNull();
    expect(await ctx.fns.session.appendErrorEvent({ id: a.id, error: "provider 500" })).not.toBeNull();
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT payload FROM events WHERE agent_id = ? AND type = 'error'", params: [a.id] });
    expect(rows.length).toBe(1);
});
