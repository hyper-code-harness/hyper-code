// Images and files on a plan task: stored the way chat attachments are, kept on the task, handed to the agent when
// it works on that task — once, and never between a tool call and its result.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "mock up.png", { type: "image/png" });
const notes = () => new File(["plain words"], "notes.txt", { type: "text/plain" });
// The attach address answers only to a request carrying the page's CSRF token, like every state-changing call.
const post = async (ctx: any, agentId: string, form: FormData, token?: string) => ctx.fns.procs.http.dispatch({
    method: "POST", url: `/agent/${agentId}/plan/attach`, body: form,
    headers: { "x-csrf-token": token ?? await ctx.fns.auth.csrfToken({ req: new Request("http://localhost/") }) },
});

test("files attached to a plan task are kept on it like chat attachments and reach the agent when it works on the task", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    (ctx.state as any).agent = { ...(ctx.state as any).agent, [agent.id]: agent };
    await ctx.fns.session.plan({ agent, title: "Site", tasks: [{ id: "text", title: "Write the text" }, { id: "cover", title: "Draw the cover" }] });
    const task = (id: string) => agent.scratchpad.plan.tasks.find((t: any) => t.id === id);
    const planRows = async () => (await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true })).filter((m: any) => m.message_type === "plan_attachments");

    // Attached to a queued task: an attachment row and a compact ref on the task — nothing in the transcript yet.
    const made = await ctx.fns.session.attachToTask({ agent, id: "cover", files: [png(), notes()] });
    expect(made).toMatchObject({ ok: true, id: "cover", attached: [{ fileName: "mock up.png", mimeType: "image/png", kind: "image" }, { fileName: "notes.txt", kind: "file" }] });
    expect(task("cover").attachments).toMatchObject([{ type: "image_ref", fileName: "mock up.png", mimeType: "image/png" }, { type: "document_ref", fileName: "notes.txt" }]);
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, message_idx, original_name, kind FROM attachments WHERE agent_id = ? ORDER BY original_name", params: [agent.id] }) as any[];
    expect(rows.map(r => `${r.original_name}:${r.kind}:${r.message_idx}`)).toEqual(["mock up.png:image:null", "notes.txt:file:null"]);
    expect(await planRows()).toEqual([]);
    // Served by the address a chat attachment has; another chat cannot read it.
    const imageId = task("cover").attachments[0].attachmentId;
    const served = await ctx.fns.procs.http.dispatch({ url: `/attachments/${agent.id}/${imageId}` });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    const stranger = await ctx.fns.agent.start({ model: "mock:test" });
    expect((await ctx.fns.procs.http.dispatch({ url: `/attachments/${stranger.id}/${imageId}` })).status).toBe(404);
    // Not referenced by any message yet — and still kept: the plan holds it.
    await ctx.fns.attachments.gc({});
    expect((await ctx.fns.procs.db.select({ sql: "SELECT id FROM attachments WHERE agent_id = ?", params: [agent.id] }) as any[])).toHaveLength(2);

    // The agent is on another task: nothing to hand over.
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 0 });
    // It finishes that one — the call that makes "cover" current is a tool call, and nothing is written during it.
    await ctx.fns.session.done({ agent, id: "text" });
    expect(await planRows()).toEqual([]);
    // Before its next request the files arrive: one message, the words first, then the same refs a chat message carries.
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 2 });
    const sent = await planRows();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ role: "user", excluded_from_cursor: true });
    expect(sent[0].content[0]).toEqual({ type: "text", text: "The user attached 2 files to plan task cover (Draw the cover): mock up.png, notes.txt. Look at them before working on the task." });
    expect(sent[0].content.slice(1)).toMatchObject([{ type: "image_ref", attachmentId: imageId, fileName: "mock up.png" }, { type: "document_ref", fileName: "notes.txt" }]);
    // What the model gets is what it gets from a chat message: the picture itself and the file's text.
    const resolved = await ctx.fns.attachments.resolveContent({ messages: sent });
    expect(resolved[0].content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(resolved[0].content[2].text).toContain("plain words");
    // Once: the next request brings nothing, and the task keeps its files for the list.
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 0 });
    expect(await planRows()).toHaveLength(1);
    expect(task("cover").attachments).toHaveLength(2);

    // Attached while the agent is on the task: only the new one is handed over.
    await ctx.fns.session.attachToTask({ agent, id: "cover", files: [new File(["more"], "more.md", { type: "text/markdown" })] });
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 1 });
    expect((await planRows())[1].content[0].text).toBe("The user attached a file to plan task cover (Draw the cover): more.md. Look at it before working on the task.");

    // Taken off the task: gone from the list; the row goes with the next clean-up unless a message still shows it.
    await ctx.fns.session.editPlanTask({ agent, action: "detach", id: "cover", file: task("cover").attachments[2].attachmentId });
    expect(task("cover").attachments.map((f: any) => f.fileName)).toEqual(["mock up.png", "notes.txt"]);
    await expect(ctx.fns.session.editPlanTask({ agent, action: "detach", id: "cover", file: "nope" })).rejects.toThrow('unknown file "nope"');

    // A finished task takes no more files; a task holds ten at most; the chat's limits apply.
    await ctx.fns.session.done({ agent, id: "cover" });
    await expect(ctx.fns.session.attachToTask({ agent, id: "cover", files: [png()] })).rejects.toThrow("a finished task takes no more files");
    await expect(ctx.fns.session.attachToTask({ agent, id: "nope", files: [png()] })).rejects.toThrow('unknown task "nope"');
    await expect(ctx.fns.session.attachToTask({ agent, files: [] })).rejects.toThrow("a task title or a file is required");
});

test("the list's upload address makes a task from a title and files, attaches to an open one, and answers with the list", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    (ctx.state as any).agent = { ...(ctx.state as any).agent, [agent.id]: agent };
    const tasks = () => agent.scratchpad.plan.tasks.map((t: any) => `${t.status}:${t.title}:${(t.attachments ?? []).map((f: any) => f.fileName).join("+")}`);

    // No plan yet: a pasted screenshot with a few words is the first task.
    let form = new FormData();
    form.set("title", "Make it look like this");
    form.append("files", png());
    let res = await post(ctx, agent.id, form);
    expect(res.status).toBe(200);
    let html = await res.text();
    expect(tasks()).toEqual(["active:Make it look like this:mock up.png"]);
    // The answer is the list, with the picture under the task as under a chat message, and a cross to take it off.
    const id = agent.scratchpad.plan.tasks[0].attachments[0].attachmentId;
    expect(html).toContain(`data-todo-attach="/agent/${agent.id}/plan/attach"`);
    expect(html).toContain(`<a class="w-attach-img" href="/attachments/${agent.id}/${id}" target="_blank" rel="noopener" draggable="false" title="mock up.png"><img src="/attachments/${agent.id}/${id}" alt="mock up.png" loading="lazy" draggable="false"></a>`);
    expect(html).toMatch(new RegExp(`data-todo-act="detach" data-todo-file="${id}"`));

    // Files alone: the task is named after the first one.
    form = new FormData();
    form.append("files", notes());
    expect((await post(ctx, agent.id, form)).status).toBe(200);
    expect(tasks()).toEqual(["active:Make it look like this:mock up.png", "pending:notes.txt:notes.txt"]);
    // Dropped on an open task.
    form = new FormData();
    form.set("id", "task-2");
    form.append("files", png());
    html = await (await post(ctx, agent.id, form)).text();
    expect(tasks()).toEqual(["active:Make it look like this:mock up.png", "pending:notes.txt:notes.txt+mock up.png"]);
    expect(html).toContain(`<a class="w-attach-file" href="/attachments/${agent.id}/`);
    // The popup takes a file off.
    html = await (await ctx.fns.agent.planPopup({ agentId: agent.id, action: "detach", id: "task-2", file: agent.scratchpad.plan.tasks[1].attachments[0].attachmentId })).text();
    expect(tasks()[1]).toBe("pending:notes.txt:mock up.png");

    // A whole message (the chat's message box, ⌘Enter): its first line names the task, all of it stays with the task
    // as its instructions — the popup shows the rest under the title, and the agent gets it when it takes the task.
    form = new FormData();
    form.set("text", "  Fix the header\n\nIt jumps on scroll.\nSee the screenshot.  ");
    form.append("files", png());
    html = await (await post(ctx, agent.id, form)).text();
    expect(agent.scratchpad.plan.tasks.at(-1)).toMatchObject({ title: "Fix the header", instructions: "Fix the header\n\nIt jumps on scroll.\nSee the screenshot.", status: "pending" });
    expect(agent.scratchpad.plan.tasks.at(-1).attachments.map((f: any) => f.fileName)).toEqual(["mock up.png"]);
    expect(html).toContain('<p class="w-todo-note">It jumps on scroll.\nSee the screenshot.</p>');
    // One line is just a title; a very long first line is cut for the title and kept whole in the text.
    form = new FormData();
    form.set("text", "Ship it");
    await post(ctx, agent.id, form);
    expect(agent.scratchpad.plan.tasks.at(-1)).toMatchObject({ title: "Ship it", instructions: "" });
    form = new FormData();
    form.set("text", "x".repeat(400));
    await post(ctx, agent.id, form);
    expect(agent.scratchpad.plan.tasks.at(-1).title).toBe("x".repeat(299) + "…");
    expect(agent.scratchpad.plan.tasks.at(-1).instructions).toBe("x".repeat(400));
    for (const id of ["task-3", "task-4", "task-5"]) await ctx.fns.session.editPlanTask({ agent, action: "remove", id });

    // What cannot be taken is said, and nothing changes; a request without the page's token is refused.
    form = new FormData();
    form.set("id", "task-2");
    res = await post(ctx, agent.id, form);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no files" });
    form = new FormData();
    form.set("title", "x");
    expect((await post(ctx, agent.id, form, "forged")).status).toBe(403);
    expect((await post(ctx, "no-such-chat", form)).status).toBe(404);
    expect(tasks()).toHaveLength(2);
});

test("a running agent gets a task's files after the tool call that made the task current — never between the call and its result", async () => {
    const ctx: any = await mkTestCtx();
    delete ctx.state.procs.hooks.handlers["agent.promptAugment"];
    // Keep this transcript-order test independent of checkout instruction files.
    ctx.state.registry.workspaceInstructions.load = async (_c: any, _s: any, opts: any) => ({dir:opts.dir,host:opts.host ?? '',root:opts.dir,sources:[],warnings:[]});
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    // The agent's first step finishes the first task (as it does with session.done from eval); then it answers.
    // (The mock model counts its turns in the live scratchpad, which a plan change re-reads from the database: the
    // count is stored there too, so the script goes on to its second turn.)
    ctx.fns.files.read = async (c: any, _s: any, _o: any) => {
        await c.fns.session.done({ agent, id: "text" });
        agent.scratchpad = (await c.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>) => { scratchpad.mockTurn = 1; } })).scratchpad;
        return "done";
    };
    agent.scratchpad.mockLLM = { turns: [{ text: "Closing the first task.", toolCalls: [{ name: "read", args: { path: "x" } }] }, { text: "Looking at the cover." }], defaultText: "ok" };
    await ctx.fns.session.save({ agent });
    await ctx.fns.session.plan({ agent, title: "Site", tasks: [{ id: "text", title: "Write the text" }, { id: "cover", title: "Draw the cover" }] });
    await ctx.fns.session.attachToTask({ agent, id: "cover", files: [png()] });

    await ctx.fns.agent.run({ agent, userText: "go" });
    const rows = (await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true })).map((m: any) => m.message_type === "plan_attachments" ? "files" : m.role === "assistant" && m.tool_calls?.length ? "call" : m.role);
    // user "go" → the call → its result → the files → the model's next answer.
    expect(rows.slice(0, 5)).toEqual(["user", "call", "tool", "files", "assistant"]);
    expect(rows.filter((r: string) => r === "files")).toHaveLength(1);
});

test("a file reaches the agent even when things go wrong on the way: a failed write is retried, a finished task refuses, a fork gets its own", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    (ctx.state as any).agent = { ...(ctx.state as any).agent, [agent.id]: agent };
    await ctx.fns.session.plan({ agent, title: "Site", tasks: [{ id: "cover", title: "Draw the cover" }, { id: "text", title: "Write the text" }] });
    const task = (a: any, id: string) => a.scratchpad.plan.tasks.find((t: any) => t.id === id);
    const planRows = async (id: string) => (await ctx.fns.session.getFullMessages({ id })).filter((m: any) => m.message_type === "plan_attachments");
    await ctx.fns.session.attachToTask({ agent, id: "cover", files: [png()] });
    await ctx.fns.session.attachToTask({ agent, id: "text", files: [notes()] });

    // The transcript write fails: the file is not marked as handed over, and the next request delivers it.
    const append = ctx.fns.session.appendMessage;
    ctx.fns.session.appendMessage = async () => { throw new Error("database is away"); };
    await expect(ctx.fns.session.sendTaskAttachments({ agent })).rejects.toThrow("database is away");
    ctx.fns.session.appendMessage = async (_c: any, _s: any, o: any) => append(o);
    expect(task(agent, "cover").attachments[0].sentAt).toBeUndefined();
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 1 });
    expect(await planRows(agent.id)).toHaveLength(1);
    // The process died after the message was written and before the file was marked: the retry writes nothing twice.
    await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>) => { delete scratchpad.plan.tasks[0].attachments[0].sentAt; } });
    agent.scratchpad = (await ctx.fns.session.load({ id: agent.id })).scratchpad;
    expect(await ctx.fns.session.sendTaskAttachments({ agent })).toEqual({ sent: 1 });
    expect(await planRows(agent.id)).toHaveLength(1);
    expect(task(agent, "cover").attachments[0].sentAt).toBeGreaterThan(0);

    // A fork carries the plan and its files. Forked from before the hand-over: it gets the picture again. Forked
    // after: it does not. Either way it can open the files of its plan — a stranger cannot.
    const offset = (await ctx.fns.session.getFullMessages({ id: agent.id })).length;
    const early = await ctx.fns.session.fork({ id: agent.id, offset: offset - 1 });
    const late = await ctx.fns.session.fork({ id: agent.id });
    expect(task(early, "cover").attachments[0].sentAt).toBeUndefined();
    expect(task(late, "cover").attachments[0].sentAt).toBeGreaterThan(0);
    expect(await ctx.fns.session.sendTaskAttachments({ agent: early })).toEqual({ sent: 1 });
    expect(await ctx.fns.session.sendTaskAttachments({ agent: late })).toEqual({ sent: 0 });
    const queued = task(late, "text").attachments[0].attachmentId;
    expect((await ctx.fns.procs.http.dispatch({ url: `/attachments/${late.id}/${queued}` })).status).toBe(200);
    expect((await ctx.fns.procs.http.dispatch({ url: `/attachments/${early.id}/${task(early, "cover").attachments[0].attachmentId}` })).status).toBe(200);
    const stranger = await ctx.fns.agent.start({ model: "mock:test" });
    expect((await ctx.fns.procs.http.dispatch({ url: `/attachments/${stranger.id}/${queued}` })).status).toBe(404);

    // The agent finishes a task while its file is still being stored: the upload is refused, nothing is left on the
    // task, and the stored row is taken back.
    const save = ctx.fns.attachments.saveUploads;
    ctx.fns.attachments.saveUploads = async (_c: any, _s: any, o: any) => { const out = await save(o); await ctx.fns.session.done({ agent, id: "cover" }); return out; };
    const before = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM attachments WHERE agent_id = ?", params: [agent.id] }) as any[]).length;
    await expect(ctx.fns.session.attachToTask({ agent, id: "cover", files: [notes()] })).rejects.toThrow("a finished task takes no more files");
    ctx.fns.attachments.saveUploads = async (_c: any, _s: any, o: any) => save(o);
    expect(task(agent, "cover").attachments).toHaveLength(1);
    expect((await ctx.fns.procs.db.select({ sql: "SELECT id FROM attachments WHERE agent_id = ?", params: [agent.id] }) as any[])).toHaveLength(before);
    // Two uploads at once cannot overfill a task: ten is checked where the plan is changed.
    const many = (n: number) => Array.from({ length: n }, (_, i) => new File([`n${i}`], `n${i}.txt`, { type: "text/plain" }));
    const results = await Promise.allSettled([ctx.fns.session.attachToTask({ agent, id: "text", files: many(5) }), ctx.fns.session.attachToTask({ agent, id: "text", files: many(5) })]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    agent.scratchpad = (await ctx.fns.session.load({ id: agent.id })).scratchpad;
    expect(task(agent, "text").attachments).toHaveLength(6);
});

test("a plan written by hand starts on the person's next chat message through the worker — and its files go with it", async () => {
    const ctx: any = await mkTestCtx();
    delete ctx.state.procs.hooks.handlers["agent.promptAugment"];
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    agent.scratchpad.mockLLM = { turns: [{ text: "On it." }], defaultText: "ok" };
    await ctx.fns.session.save({ agent });
    // Tasks typed into the list while the agent is idle: the plan waits.
    await ctx.fns.session.attachToTask({ agent, title: "Make it look like this", files: [png()] });
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    const files = async () => (await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true })).filter((m: any) => m.message_type === "plan_attachments");

    // A caller whose message is already stored may pass no userText at all: the run must not trip over that.
    agent.scratchpad.mockTurn = 0;
    await ctx.fns.agent.run({ agent, userMessageAlreadyAppended: true });
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);

    // Something that is not the person's word — a context row — does not start a plan the person left waiting.
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "a job finished", message_type: "world_state", excluded_from_cursor: true } });
    await ctx.fns.session.syncAgentState({ agent });
    agent.scratchpad.mockTurn = 0;
    await ctx.fns.agent.run({ agent, userText: "", userMessageAlreadyAppended: true });
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    expect(await files()).toEqual([]);

    // Neither does another agent speaking in this chat.
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "a peer asks something", author: "agent:zz" });
    await ctx.fns.session.syncAgentState({ agent });
    agent.scratchpad.mockTurn = 0;
    await ctx.fns.agent.run({ agent, userText: "", userMessageAlreadyAppended: true });
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET last_processed_msg_idx = (SELECT MAX(idx) FROM messages WHERE agent_id = ?) WHERE id = ?", params: [agent.id, agent.id] });

    // The person writes in the chat instead of pressing Start; the worker runs with the message already stored.
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "do the plan" });
    await ctx.fns.session.syncAgentState({ agent });
    agent.scratchpad.mockTurn = 0;
    await ctx.fns.agent.run({ agent, userText: "", userMessageAlreadyAppended: true });
    expect(agent.scratchpad.plan.pausedAt).toBeNull();
    expect(agent.scratchpad.plan.tasks[0].activeSince).toBeGreaterThan(0);
    expect(await files()).toHaveLength(1);
});
