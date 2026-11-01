/** Creates one agent from the native mobile form. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    let body: any;
    try { body = await opts.req.json(); } catch { return Response.json({ error: "invalid_json", message: "Expected JSON" }, { status: 400 }); }
    const result = await ctx.fns.agent.createFromValues({
        title: typeof body.title === "string" ? body.title : "",
        workspaceDir: typeof body.workspaceDir === "string" ? body.workspaceDir : "",
        createWorkspaceDir: body.createWorkspaceDir === true ? "1" : undefined,
        model: typeof body.model === "string" ? body.model : "",
        systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : "",
        systemPromptName: typeof body.systemPromptName === "string" ? body.systemPromptName : "",
        systemPromptCore: typeof body.systemPromptCore === "string" ? body.systemPromptCore : "",
        projectId: typeof body.projectId === "string" ? body.projectId : "",
    });
    if (result.error) return Response.json({ error: "invalid_agent", message: result.error }, { status: 400 });
    if (result.confirmation) return Response.json({ error: "workspace_missing", message: `Workspace does not exist: ${result.confirmation.dir}`, workspaceDir: result.confirmation.dir }, { status: 409 });
    const agent = result.agent!;
    return Response.json({ version: 1, agent: { id: agent.id, title: agent.title || agent.id, model: agent.model, workspaceDir: agent.workspaceDir || "", projectId: agent.projectId ?? (typeof body.projectId === "string" && body.projectId ? body.projectId : null) } }, { status: 201 });
}
