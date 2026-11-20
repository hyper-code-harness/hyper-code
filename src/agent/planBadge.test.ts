// The chat's plan in its message box: one small count ("2/4") after the goal's icon, and the to-do list it opens
// (agent.planPopup) — tasks are added, ticked, reordered and removed there.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("a chat's plan is one count in its message box; the popup is a to-do list: current task, queue, add field, finished at the bottom", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const id = agent.id;
    const badge = () => ctx.fns.agent.planBadge({ agentId: id });
    const popup = async (change: Record<string, unknown> = {}) => await (await ctx.fns.agent.planPopup({ agentId: id, ...change })).text();
    const column = () => ctx.fns.ui.chatColumn({ agentId: id });
    const pill = (html: string) => ({ count: />(\d+\/\d+)<\/button>/.exec(html)?.[1], tone: /class="w-badge" data-tone="(\w+)"/.exec(html)?.[1], status: /data-status="([\w-]+)"/.exec(html)?.[1], title: /title="([^"]*)"/.exec(html)?.[1] });
    // The tasks of the popup as "status:title", in the order they are drawn.
    const steps = (html: string) => [...html.matchAll(/<li class="w-todo-item" data-status="(\w+)"[\s\S]*?<span class="w-todo-text"[^>]*>([^<]*)<\/span>/g)].map(m => `${m[1]}:${m[2]}`);
    const summary = (html: string) => /data-todo-summary>([^<]*)/.exec(html)?.[1];

    // No plan: a quiet list icon that opens an empty list, and the popup invites to write the first task.
    let html = await badge();
    expect(html).toContain('class="w-icon-button"');
    expect(html).toContain('title="No plan — click to add tasks"');
    expect(html).toContain('data-status="none"');
    expect(html).toContain("ph-list-checks");
    expect(await column()).toMatch(/id="chat-plan-badge"[^>]*hx-get="\/agent\/[^"]+\/plan-badge"/);
    html = await popup();
        expect(html).toContain("This chat has no plan yet.");
    expect(html).toContain('placeholder="Add the first task…"');
    expect(steps(html)).toEqual([]);

    await ctx.fns.session.plan({ agent, title: "Release", tasks: [
        { id: "build", title: "Build it", instructions: "Run the build and fix what breaks." },
        { id: "test", title: "Test it" },
        { id: "ship", title: "Ship it" },
    ] });
    // Working on the first task: a blue count, and the tooltip names the plan and the task.
    html = await badge();
    expect(pill(html)).toEqual({ count: "0/3", tone: "info", status: "working", title: "Release · 0 of 3 tasks done · now: Build it — click to open" });
    expect(html).toContain('hx-popup="agent.planPopup"');
    expect(await column()).toContain(html);

    html = await popup();
    expect(html).toContain('data-popup-title="Release"');
    expect(html).toContain('data-state="working"');
    expect(steps(html)).toEqual(["active:Build it", "pending:Test it", "pending:Ship it"]);
    // The current task carries its instructions and a running clock; the list re-reads itself on the chat's topic
    // and sends its changes back to this function.
    expect(html).toContain("Run the build and fix what breaks.");
    expect(html).toMatch(/class="w-timer"[^>]*data-since="\d+"/);
    expect(html).toContain(`data-todo-rpc="agent.planPopup" data-todo-params="{&quot;agentId&quot;:&quot;${id}&quot;}" data-todo-attach="/agent/${id}/plan/attach" data-live-topic="agent:${id}"`);
    expect(summary(html)).toBe("0 of 3 done");
    // Working: no Start button.
    expect(html).not.toContain('data-todo-act="start"');

    // A task done: the count moves, and the finished task goes under the folded "Done · 1" line at the bottom.
    await ctx.fns.session.done({ agent, id: "build" });
    expect(pill(await badge())).toMatchObject({ count: "1/3", tone: "info", title: "Release · 1 of 3 tasks done · now: Test it — click to open" });
    html = await popup();
    expect(steps(html)).toEqual(["active:Test it", "pending:Ship it", "done:Build it"]);
    expect(html).toMatch(/data-todo-add[\s\S]*<details class="w-todo-done" data-todo-done-box><summary>[\s\S]*Done · 1[\s\S]*Build it/);
    expect(html).not.toContain("Run the build and fix what breaks.");
    expect(summary(html)).toMatch(/^1 of 3 done/);

    // The popup applies a change and answers with the new list: add, reorder, tick, rename, remove.
    html = await popup({ action: "add", title: "Announce it" });
    expect(steps(html)).toEqual(["active:Test it", "pending:Ship it", "pending:Announce it", "done:Build it"]);
    expect(pill(await badge())).toMatchObject({ count: "1/4" });
    html = await popup({ action: "move", order: ["task-4", "ship"] });
    expect(steps(html)).toEqual(["active:Test it", "pending:Announce it", "pending:Ship it", "done:Build it"]);
    html = await popup({ action: "rename", id: "task-4", title: "Announce <it>" });
    expect(steps(html)).toEqual(["active:Test it", "pending:Announce &lt;it&gt;", "pending:Ship it", "done:Build it"]);
    html = await popup({ action: "remove", id: "task-4" });
    expect(steps(html)).toEqual(["active:Test it", "pending:Ship it", "done:Build it"]);
    // A change that cannot be made is said in the list, which stays as it was.
    html = await popup({ action: "remove", id: "test" });
    expect(/data-todo-error role="alert">([^<]*)/.exec(html)?.[1]).toBe("Only a task that has not started can be removed");
    expect(steps(html)).toEqual(["active:Test it", "pending:Ship it", "done:Build it"]);

    // The current task ticked by hand while the agent is idle: the next one waits — a grey count, "Paused", and a
    // Continue button that tells the agent to take it.
    html = await popup({ action: "done", id: "test" });
    expect(steps(html)).toEqual(["active:Ship it", "done:Build it", "done:Test it"]);
    expect(html).toContain('data-state="waiting"');
    expect(summary(html)).toMatch(/^Paused · 2 of 3 done/);
    expect(html).toMatch(/data-todo-act="start"[^>]*>.*Continue/);
    expect(pill(await badge())).toMatchObject({ count: "2/3", tone: "neutral", status: "paused", title: "Release · 2 of 3 tasks done · paused at: Ship it — click to open" });
    html = await popup({ action: "start" });
    expect(html).toContain('data-state="working"');
    expect(html).not.toContain('data-todo-act="start"');
    expect(pill(await badge())).toMatchObject({ count: "2/3", tone: "info", status: "working" });

    // All done: a green count.
    await ctx.fns.session.done({ agent, id: "ship" });
    expect(pill(await badge())).toMatchObject({ count: "3/3", tone: "success", status: "done", title: "Release · 3 of 3 tasks done · all done — click to open" });
    html = await popup();
    expect(html).toContain('data-state="done"');
    expect(steps(html)).toEqual(["done:Build it", "done:Test it", "done:Ship it"]);
    expect(summary(html)).toMatch(/^All done/);
    // A finished task can be reopened: it becomes the current one and waits.
    html = await popup({ action: "reopen", id: "test" });
    expect(steps(html)).toEqual(["active:Test it", "done:Build it", "done:Ship it"]);

    // Details opens the full plan editor (the agent inspector) on the canvas and closes the popup (an empty answer).
    expect(html).toMatch(/data-todo-act="edit"[^>]*>.*Details/);
    expect(await popup({ action: "edit" })).toBe("");
    expect(await ctx.fns.canvas.get({ agentId: id })).toMatchObject({ open: true });
    expect((await ctx.fns.canvas.list({ agentId: id })).map((t: any) => t.title)).toEqual(["Agent"]);

    // Removed: back to the quiet icon.
    await ctx.fns.session.removePlan({ agent, archive: true });
    expect(await badge()).toContain('data-status="none"');
    // A chat that does not exist has nothing.
    expect(await ctx.fns.agent.planBadge({ agentId: "no-such-chat" })).toBe("");
});
