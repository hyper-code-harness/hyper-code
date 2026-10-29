const BUILTIN = new Set(["full", "lean", "custom"]);

/**
 * Saves a named system prompt for a person or a project, creating it or replacing its text.
 *
 * The saved prompt appears in agent.systemPrompts and in the New agent form, and any chat can switch to it with
 * agent.setSystemPrompt. Scope user (default) keeps it for its author and their chats; scope project shares it
 * with every chat of the project. Built-in names (full, lean) and `custom` are reserved. The text is the base of
 * the system prompt: tools, memory, canvas, plugins and the runtime block are still added on every turn.
 * @param opts.name Short name: lower-case letters, digits, dot, dash and underscore, up to 40 characters.
 * @param opts.text Full text of the base prompt.
 * @param opts.title Human title shown in pickers. @default name
 * @param opts.scope Who sees it: the person (user) or the project. @default "user"
 * @param opts.userId Owner for scope user; defaults to the signed-in person or the agent's creator.
 * @param opts.projectId Project for scope project; defaults to the agent's project.
 * @param opts.agentId Agent whose creator or project is the owner when not given.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Short name: lower-case letters, digits, dot, dash and underscore, up to 40 characters. */
    name: string;
    /** Full text of the base prompt. */
    text: string;
    /** Human title shown in pickers. @default name */
    title?: string;
    /** Who sees it: the person (user) or the project. @default "user" */
    scope?: "user" | "project";
    /** Owner for scope user; defaults to the signed-in person or the agent's creator. */
    userId?: string | null;
    /** Project for scope project; defaults to the agent's project. */
    projectId?: string | null;
    /** Agent whose creator or project is the owner when not given. */
    agentId?: string;
}): Promise<{ name: string; scope: "user" | "project"; ownerId: string }> {
    const name = String(opts.name ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(name)) throw new Error("agent.saveSystemPrompt: name must be 1-40 chars of a-z, 0-9, '.', '-', '_'");
    if (BUILTIN.has(name)) throw new Error(`agent.saveSystemPrompt: "${name}" is a built-in name`);
    const text = String(opts.text ?? "");
    if (!text.trim()) throw new Error("agent.saveSystemPrompt: text is empty");
    if (text.length > 200_000) throw new Error("agent.saveSystemPrompt: text is over 200000 characters");
    const scope = opts.scope === "project" ? "project" : "user";
    const agentId = opts.agentId ?? (session as any)?.agentId;
    const row = agentId ? ((await ctx.fns.procs.db.select({ sql: "SELECT created_by, project_id FROM agents WHERE id = ?", params: [agentId] })) as any[])[0] : null;
    const ownerId = scope === "project"
        ? String(opts.projectId ?? row?.project_id ?? "")
        : String(opts.userId ?? (session as any)?.user?.id ?? row?.created_by ?? "");
    if (!ownerId) throw new Error(scope === "project" ? "agent.saveSystemPrompt: no project; pass projectId or use scope user" : "agent.saveSystemPrompt: no person to own it; pass userId");
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO system_prompts (name, title, text, scope, owner_id, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (scope, owner_id, name) DO UPDATE SET title = excluded.title, text = excluded.text, updated_at = excluded.updated_at`,
        params: [name, String(opts.title ?? "").trim().slice(0, 120) || name, text, scope, ownerId, (session as any)?.user?.id ?? row?.created_by ?? null, now, now],
    });
    return { name, scope, ownerId };
}
