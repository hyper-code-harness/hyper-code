/**
 * Hands the files attached to the plan task in work over to the agent as one message with attachment refs.
 *
 * Use at a moment when a user row may be appended to the transcript — agent.run calls it before every provider
 * request, after the tool results of the previous step are written. Files of the current task that were not handed
 * over yet (session.attachToTask) are appended as one user message and then marked as sent: a line naming the task plus
 * the same image_ref / document_ref parts a chat message with attachments carries, so attachments.resolveContent
 * shows the model images, PDFs and text exactly as it does in chat. Nothing is sent while the plan is paused, for a
 * task without new files, or twice; a failure leaves the files unsent for the next request. Never call it from inside a tool call (session.done): a user row between a call
 * and its result breaks the request for some providers.
 * @param opts.agent Agent that owns the plan; defaults to the current session agent.
 * @param opts.id Plan task whose files are handed over; defaults to the task in work, and to nothing while the plan is paused.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent that owns the plan; defaults to the current session agent. */
        agent?: types.agent.Agent;
        /** Plan task whose files are handed over; defaults to the task in work, and to nothing while the plan is paused. */
        id?: string;
    },
): Promise<{ sent: number }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("sendTaskAttachments: agent is required");
    const wanted = String(opts.id ?? "").trim();
    const pick = (scratchpad: Record<string, any> | undefined) => {
        const plan = scratchpad?.plan;
        const tasks: any[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
        const task = wanted ? tasks.find(item => String(item?.id) === wanted) : plan?.pausedAt ? null : tasks.find(item => item?.status === "active");
        const files: any[] = (Array.isArray(task?.attachments) ? task.attachments : []).filter((file: any) => file?.attachmentId && !file.sentAt);
        return { id: String(task?.id ?? ""), title: String(task?.title ?? ""), files };
    };
    // The usual answer, without touching the database: nothing new.
    if (!pick(agent.scratchpad).files.length) return { sent: 0 };
    // Between an assistant's tool call and its result nothing may be inserted (agent.syncWorldState keeps the same
    // rule): the files wait for the next request.
    const tail: any = Array.isArray(agent.messages) ? agent.messages[agent.messages.length - 1] : null;
    if (tail?.role === "assistant" && tail?.tool_calls?.length) return { sent: 0 };
    const found = pick(agent.scratchpad);
    const files: Array<{ type: "image_ref" | "document_ref"; attachmentId: string; fileName: string; mimeType: string; size: number }> = found.files.map((file: any) => ({ type: file.type === "image_ref" ? "image_ref" : "document_ref", attachmentId: String(file.attachmentId), fileName: String(file.fileName ?? "attachment"), mimeType: String(file.mimeType ?? "application/octet-stream"), size: Number(file.size ?? 0) }));
    const text = `The user attached ${files.length === 1 ? "a file" : `${files.length} files`} to plan task ${found.id} (${found.title}): ${files.map(file => file.fileName).join(", ")}. Look at ${files.length === 1 ? "it" : "them"} before working on the task.`;
    // Appended first, marked after. A failed append leaves the files unsent, so the next request tries again; a crash
    // between the two repeats the append with the same request id, which the transcript refuses to store twice.
    // Context for the task, not a new request: it does not move the cursor.
    const ids = files.map(file => file.attachmentId);
    await ctx.fns.session.appendMessage({
        id: agent.id,
        message: { role: "user", content: [{ type: "text", text }, ...files], message_type: "plan_attachments", excluded_from_cursor: true },
        clientRequestId: `plan-files:${found.id}:${Bun.hash(ids.join(",")).toString(36)}`,
    });
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
        for (const task of Array.isArray(scratchpad.plan?.tasks) ? scratchpad.plan.tasks : [])
            for (const file of Array.isArray(task?.attachments) ? task.attachments : [])
                if (ids.includes(String(file?.attachmentId))) file.sentAt ??= now;
    } });
    agent.scratchpad = updated.scratchpad;
    await ctx.fns.session.syncAgentState({ agent });
    return { sent: files.length };
}
