// One change to a plan made by hand, as in a to-do list (the plan popup): add, tick off, reopen, remove, rename, reorder.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("a person edits a plan like a to-do list: tasks keep one order — finished, current, queue — and an idle agent's plan waits", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const edit = (opts: Record<string, unknown>) => ctx.fns.session.editPlanTask({ agent, ...opts });
    const tasks = () => agent.scratchpad.plan.tasks.map((t: any) => `${t.status}:${t.title}`);

    // No plan yet: the first task added makes one. Nobody works, so it waits (paused) and its clock does not run.
    expect((await edit({ action: "add", title: "  Write   the text " })).added).toBe("task-1");
    expect(tasks()).toEqual(["active:Write the text"]);
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    expect(agent.scratchpad.plan.tasks[0].activeSince).toBeNull();
    await edit({ action: "add", title: "Draw" });
    await edit({ action: "add", title: "Publish" });
    await edit({ action: "add", title: "Announce" });
    expect(tasks()).toEqual(["active:Write the text", "pending:Draw", "pending:Publish", "pending:Announce"]);

    // Reorder; an id that is not listed keeps its place after the listed ones.
    await edit({ action: "move", order: ["task-1", "task-4", "task-2"] });
    expect(tasks()).toEqual(["active:Write the text", "pending:Announce", "pending:Draw", "pending:Publish"]);
    // The plan waits, nobody is on the current task — so it moves with the others, and the first one is current.
    await edit({ action: "move", order: ["task-2", "task-1", "task-4"] });
    expect(tasks()).toEqual(["active:Draw", "pending:Write the text", "pending:Announce", "pending:Publish"]);
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    expect(agent.scratchpad.plan.tasks.map((t: any) => t.activeSince)).toEqual([null, null, null, null]);
    await edit({ action: "move", order: ["task-1", "task-2", "task-4"] });
    expect(tasks()).toEqual(["active:Write the text", "pending:Draw", "pending:Announce", "pending:Publish"]);

    await edit({ action: "rename", id: "task-2", title: "Draw the cover" });
    // A queued task ticked off is skipped: it goes to the finished ones.
    await edit({ action: "done", id: "task-3" });
    expect(tasks()).toEqual(["done:Publish", "active:Write the text", "pending:Draw the cover", "pending:Announce"]);
    // The current one ticked off: the next of the queue becomes current — and waits, the agent is idle.
    await edit({ action: "done", id: "task-1" });
    expect(tasks()).toEqual(["done:Publish", "done:Write the text", "active:Draw the cover", "pending:Announce"]);
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    expect(agent.scratchpad.plan.tasks[2].activeSince).toBeNull();

    // Reopened: first in the queue, not the current one.
    await edit({ action: "reopen", id: "task-3" });
    expect(tasks()).toEqual(["done:Write the text", "active:Draw the cover", "pending:Publish", "pending:Announce"]);
    // Only a task that has not started can be removed.
    await edit({ action: "remove", id: "task-4" });
    expect(tasks()).toEqual(["done:Write the text", "active:Draw the cover", "pending:Publish"]);
    await expect(edit({ action: "remove", id: "task-2" })).rejects.toThrow("only a task that has not started can be removed");
    await expect(edit({ action: "remove", id: "task-1" })).rejects.toThrow("only a task that has not started can be removed");

    // What is stored is what the live agent holds.
    expect((await ctx.fns.session.load({ id: agent.id })).scratchpad.plan.tasks.map((t: any) => t.id)).toEqual(["task-1", "task-2", "task-3"]);
    // A new id never repeats one that is there.
    expect((await edit({ action: "add", title: "Again" })).added).toBe("task-4");

    await expect(edit({ action: "add", title: "   " })).rejects.toThrow("a task title of 1–300 characters is required");
    await expect(edit({ action: "rename", id: "nope", title: "X" })).rejects.toThrow('unknown task "nope"');
    await expect(edit({ action: "explode" })).rejects.toThrow("unknown action");
});

test("while the agent works a task added to a finished plan starts at once, and ticking the current task starts the next", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.plan({ agent, title: "Release", tasks: [{ id: "build", title: "Build" }, { id: "ship", title: "Ship" }] });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'running' WHERE id = ?", params: [agent.id] });

    // The agent is on the current task: it stays where it is, only the queue is reordered.
    await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Tell" });
    await ctx.fns.session.editPlanTask({ agent, action: "move", order: ["task-3", "build", "ship"] });
    expect(agent.scratchpad.plan.tasks.map((t: any) => `${t.status}:${t.id}`)).toEqual(["active:build", "pending:task-3", "pending:ship"]);
    await ctx.fns.session.editPlanTask({ agent, action: "remove", id: "task-3" });

    await ctx.fns.session.editPlanTask({ agent, action: "done", id: "build" });
    expect(agent.scratchpad.plan.tasks.map((t: any) => `${t.status}:${t.id}`)).toEqual(["done:build", "active:ship"]);
    expect(agent.scratchpad.plan.pausedAt).toBeNull();
    expect(agent.scratchpad.plan.tasks[1].activeSince).toBeGreaterThan(0);

    await ctx.fns.session.done({ agent, id: "ship" });
    await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Tell everyone" });
    expect(agent.scratchpad.plan.tasks.map((t: any) => `${t.status}:${t.title}`)).toEqual(["done:Build", "done:Ship", "active:Tell everyone"]);
    expect(agent.scratchpad.plan.pausedAt).toBeNull();
    expect(agent.scratchpad.plan.title).toBe("Release");
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'idle' WHERE id = ?", params: [agent.id] });

    // A chat without a plan has nothing to tick.
    const other = await ctx.fns.agent.start({ model: "mock:test" });
    await expect(ctx.fns.session.editPlanTask({ agent: other, action: "done", id: "x" })).rejects.toThrow("this chat has no plan");
});
