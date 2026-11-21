/**
 * Attaches uploaded images and files to a plan task, or makes a new task with them.
 *
 * Use at the upload ingress of the plan's to-do list (POST /agent/:id/plan/attach). Files are stored exactly as chat attachments are (attachments.saveUploads / commitUploads: same limits, same blobs, same refs) and their refs are kept on the task as task.attachments, so they are served by /attachments/:agentId/:id and survive plan edits. With id the files go to that open task; without it a task is added (titled by title, or by the first file's name) and takes them. The agent receives the files when it works on the task: agent.run hands them over before its next request (session.sendTaskAttachments). Remove one with session.editPlanTask action detach.
 * @param opts.agent Agent that owns the plan; defaults to the current session agent.
 * @param opts.id Open task that takes the files; omit to add a new task.
 * @param opts.title Title of the new task when id is omitted; defaults to the first file's name.
 * @param opts.instructions Full text of the new task when id is omitted (session.editPlanTask add).
 * @param opts.files Uploaded files: at most 10 per call and per task, 25 MB each.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent that owns the plan; defaults to the current session agent. */
        agent?: types.agent.Agent;
        /** Open task that takes the files; omit to add a new task. */
        id?: string;
        /** Title of the new task when id is omitted; defaults to the first file's name. */
        title?: string;
        /** Full text of the new task when id is omitted (session.editPlanTask add). */
        instructions?: string;
        /** Uploaded files: at most 10 per call and per task, 25 MB each. */
        files: File[];
    },
): Promise<{ ok: true; id: string; attached: Array<{ id: string; fileName: string; mimeType: string; size: number; kind: string }> }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("attachToTask: agent is required");
    let id = String(opts.id ?? "").trim();
    const title = String(opts.title ?? "").replace(/\s+/g, " ").trim();
    const files = (Array.isArray(opts.files) ? opts.files : []).filter(file => file instanceof File && file.size > 0);
    const find = (taskId: string) => (Array.isArray(agent.scratchpad?.plan?.tasks) ? agent.scratchpad.plan.tasks : []).find((item: any) => String(item?.id) === taskId);
    if (id) {
        const task = find(id);
        if (!task) throw new Error("attachToTask: unknown task " + JSON.stringify(id));
        if (task.status === "done") throw new Error("attachToTask: a finished task takes no more files");
        if (!files.length) throw new Error("attachToTask: no files");
        if ((Array.isArray(task.attachments) ? task.attachments.length : 0) + files.length > 10) throw new Error("attachToTask: a task holds at most 10 files");
    } else if (!title && !files.length) throw new Error("attachToTask: a task title or a file is required");
    
    // Stored the way chat uploads are: content-addressed blobs, a row per file, a compact ref to carry around.
    const uploads = await ctx.fns.attachments.saveUploads({ agentId: agent.id, files });
    if (!id) {
        const made = await ctx.fns.session.editPlanTask({ agent, action: "add", title: (title || String(uploads[0]?.meta.fileName ?? "")).slice(0, 300), instructions: opts.instructions });
        id = String(made.added ?? "");
    }
    if (uploads.length) {
        await ctx.fns.attachments.commitUploads({ agentId: agent.id, messageIdx: null, uploads });
        // The task is checked again where the plan is changed: storing a file takes time (a PDF is read), and
        // meanwhile the agent may have finished the task or another upload may have filled it.
        const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
            const task = (Array.isArray(scratchpad.plan?.tasks) ? scratchpad.plan.tasks : []).find((item: any) => String(item?.id) === id);
            if (!task) throw new Error("attachToTask: unknown task " + JSON.stringify(id));
            if (task.status === "done") throw new Error("attachToTask: a finished task takes no more files");
            const have: any[] = Array.isArray(task.attachments) ? task.attachments : [];
            if (have.length + uploads.length > 10) throw new Error("attachToTask: a task holds at most 10 files");
            task.attachments = [...have, ...uploads.map(item => ({ ...item.ref }))];
            scratchpad.plan.updatedAt = now;
        } }).catch(async (error: any) => {
            // Refused: the rows just written belong to nothing (their blobs go with the next attachments.gc).
            for (const item of uploads) await ctx.fns.procs.db.run({ sql: "DELETE FROM attachments WHERE id = ?", params: [item.meta.id] });
            throw error;
        });
        agent.scratchpad = updated.scratchpad;
    }
    ctx.fns.events.refreshAgentMeta({ agentId: agent.id, section: "plan", reason: "plan-attach" });
    return { ok: true, id, attached: uploads.map(item => item.meta) };
}
