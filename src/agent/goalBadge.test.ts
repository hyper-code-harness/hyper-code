// The chat's goal in its message box: a target icon beside the subagents and jobs badges that opens the editor
// (agent.goalPopup), and the active goal kept in the agent's world state.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("the message box always has the goal's target button — grey without an active goal, blue with one; the popup starts, pauses and removes it", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const id = agent.id;
    const badge = () => ctx.fns.agent.goalBadge({ agentId: id });
    const popup = async (params: Record<string, unknown> = {}) => await (await ctx.fns.agent.goalPopup({ agentId: id, ...params })).text();
    const column = () => ctx.fns.ui.chatColumn({ agentId: id });
    // The colour of the icon is its tone: none = grey (the plain icon button colour), info = blue, an active goal.
    // Never a pressed background.
    const tone = (html: string) => { expect(html).not.toContain("aria-pressed"); return /data-tone="([^"]+)"/.exec(html)?.[1] ?? "grey"; };
    // The buttons of the form, in order, as "action:label"; and its one-line state.
    const buttons = (html: string) => [...html.matchAll(/<button[^>]*name="action" value="(\w+)"[^>]*>(?:<i[^>]*><\/i>)?<span>([^<]*)/g)].map(m => `${m[1]}:${m[2]}`);
    const now = (html: string) => (/data-goal-now>.*<span class="min-w-0">([^<]*)<\/span><\/p>/s.exec(html)?.[1] ?? "");

    // No goal: the icon is there all the same, grey, and opens the form — one field and Start.
    let icon = await badge();
    expect(icon).toContain("ph-target");
    expect(icon).toContain("No goal — click to set one");
    expect(icon).toContain("agent.goalPopup");
    expect(tone(icon)).toBe("grey");
    expect(await column()).toMatch(/id="chat-goal-badge"[^>]*hx-get="\/agent\/[^"]+\/goal-badge"/);
    let html = await popup();
    expect(html).toContain('data-goal-state="new"');
    expect(html).toContain("Done when…");
    expect(buttons(html)).toEqual(["start:Start", "save:Save without starting"]);
    expect(now(html)).toBe("");

    // Start with nothing written is refused in place; nothing is saved.
    html = await popup({ action: "start", statement: "  " });
    expect(html).toContain("Write the goal first.");
    expect(agent.goal ?? null).toBeNull();

    // Start: the goal is saved and running, and the popup closes (an empty answer).
    expect(await popup({ action: "start", statement: "ship the release", iterations: "5" })).toBe("");
    expect(agent.goal).toMatchObject({ statement: "ship the release", enabled: true, maxIterations: 5 });
    icon = await badge();
    expect(icon).toContain("ph-target");
    expect(tone(icon)).toBe("info");
    expect(icon).toContain("Goal active: ship the release — click to edit");
    // It sits before the subagents and jobs badges, left of the context ring.
    const page = await column();
    expect(page).toContain("Goal active: ship the release");
    expect(page.indexOf('id="chat-goal-badge"')).toBeGreaterThan(-1);
    expect(page.indexOf('id="chat-goal-badge"')).toBeLessThan(page.indexOf('id="chat-team-badge"'));
    expect(page.indexOf('id="chat-team-badge"')).toBeLessThan(page.indexOf('id="chat-context-ring"'));
    // The route its live region polls.
    const res = await ctx.fns.procs.http.dispatch({ method: "GET", url: `http://localhost/agent/${id}/goal-badge` });
    expect(await res.text()).toBe(icon);

    // Running: the form says so and offers Save, Pause, Remove; the limit shows what was chosen.
    html = await popup();
    expect(html).toContain('data-goal-state="running"');
    expect(html).toContain("ship the release</textarea>");
    expect(buttons(html)).toEqual(["save:Save", "pause:Pause", "remove:Remove"]);
    expect(now(html)).toBe("Running. The checker looks each time the agent wants to stop.");
    expect(html).toMatch(/<option value="5" selected/);
    // The checker's last verdict is the state line.
    await ctx.fns.agent.recordGoalCheck({ agent, check: { status: "continue", reason: "tests are still red" } });
    expect(now(await popup())).toBe("Running. Last check: continue — tests are still red");
    // Save keeps it running and only changes the text.
    expect(await popup({ action: "save", statement: "ship the release today", iterations: "5" })).toBe("");
    expect(agent.goal).toMatchObject({ statement: "ship the release today", enabled: true });

    // Pause: the goal stays, the icon goes grey, the form offers Resume.
    expect(await popup({ action: "pause", statement: "ship the release today", iterations: "5" })).toBe("");
    expect(agent.goal).toMatchObject({ statement: "ship the release today", enabled: false });
    icon = await badge();
    expect(tone(icon)).toBe("grey");
    expect(icon).toContain("Goal paused: ship the release today");
    html = await popup();
    expect(html).toContain('data-goal-state="paused"');
    expect(buttons(html)).toEqual(["start:Resume", "save:Save without starting", "remove:Remove"]);
    expect(now(html)).toBe("Paused. Start to continue.");
    // Save without starting keeps it paused.
    expect(await popup({ action: "save", statement: "ship the release", iterations: "3" })).toBe("");
    expect(agent.goal).toMatchObject({ statement: "ship the release", enabled: false, maxIterations: 3 });

    // The checker gave up: grey, with its reason; Start again.
    await ctx.fns.agent.setGoal({ id, statement: "ship the release", iterations: 3, enabled: true });
    await ctx.fns.agent.recordGoalCheck({ agent, check: { status: "needs_user", reason: "waiting for the release notes" } });
    await ctx.fns.agent.setGoal({ id, statement: "ship the release", iterations: 3, enabled: false });
    icon = await badge();
    expect(tone(icon)).toBe("grey");
    expect(icon).toContain("Goal needs user: ship the release");
    html = await popup();
    expect(html).toContain('data-goal-state="stopped"');
    expect(now(html)).toBe("Stopped: needs user — waiting for the release notes");
    expect(buttons(html)).toEqual(["start:Start again", "save:Save without starting", "remove:Remove"]);

    // Reached by the checker.
    await ctx.fns.agent.setGoal({ id, statement: "ship the release", iterations: 3, enabled: true });
    await ctx.fns.agent.recordGoalCheck({ agent, check: { status: "achieved", reason: "released" } });
    icon = await badge();
    expect(icon).toContain("Goal reached: ship the release");
    expect(tone(icon)).toBe("grey");
    html = await popup();
    expect(html).toContain('data-goal-state="reached"');
    expect(now(html)).toBe("Reached — released");

    // Removed: back to the grey "no goal" icon.
    expect(await popup({ action: "remove" })).toBe("");
    expect(agent.goal).toBeNull();
    icon = await badge();
    expect(icon).toContain("No goal — click to set one");
    expect(tone(icon)).toBe("grey");
    // A chat that does not exist has no button.
    expect(await ctx.fns.agent.goalBadge({ agentId: "no-such-chat" })).toBe("");
});

test("the active goal is part of the agent's world state, with the checker's last verdict", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const block = async () => String((await ctx.fns.procs.hooks.run({ name: "agent.promptAugment", opts: { agentId: agent.id, text: "" } })).find((b: string) => String(b).startsWith("## Goal")) ?? "");
    expect(await block()).toBe("");
    await ctx.fns.agent.setGoal({ id: agent.id, statement: "ship the release", iterations: 2, enabled: true });
    expect(await block()).toBe("## Goal\n\nThe person set a goal for this chat; a checker verifies it before you may stop, up to 2 times a turn:\nship the release");
    await ctx.fns.agent.recordGoalCheck({ agent, check: { status: "continue", reason: "tests are still red" } });
    expect(await block()).toContain("ship the release\nLast check: continue — tests are still red");
    // Paused or reached: nothing to hold the agent to.
    await ctx.fns.agent.setGoal({ id: agent.id, statement: "ship the release", iterations: 2, enabled: false });
    expect(await block()).toBe("");
});
