// POST /agent/:id/plan/attach — files for the plan's to-do list (agent.planPopup): multipart `files`, with `id` to
// attach them to that task or with `title` to add a task that takes them. The same upload path as a chat message
// (attachments.saveUploads). Answers with the new list, like every change the list sends.
/** Attaches uploaded files to a plan task or adds a task with them, and answers with the plan's to-do list.
 * @param opts.req Multipart request: `files` (one or more), `id` (task) or `title` (new task).
 * @param opts.params Route parameters; `id` is the chat.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Multipart request: `files` (one or more), `id` (task) or `title` (new task). */
    req: Request;
    /** Route parameters; `id` is the chat. */
    params: Record<string, string>;
}): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    if (!await ctx.fns.auth.verifyCsrf({ req: opts.req, token: opts.req.headers.get("x-csrf-token") ?? "" })) return Response.json({ error: "invalid csrf token" }, { status: 403 });
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return Response.json({ error: "not your chat" }, { status: 403 });
    const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    if (!agent) return Response.json({ error: "not found" }, { status: 404 });
    try {
        const form = await opts.req.formData();
        const files = [...form.getAll("files"), ...form.getAll("file")].filter(value => value instanceof File && value.size > 0) as File[];
        const text = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)) : "";
        await ctx.fns.session.attachToTask({ agent, id: text("id") || undefined, title: text("title") || undefined, files });
    } catch (error: any) {
        return Response.json({ error: String(error?.message ?? error).replace(/^(attachToTask|editPlanTask): /, "") }, { status: 400 });
    }
    return ctx.fns.agent.planPopup({ agentId });
}
