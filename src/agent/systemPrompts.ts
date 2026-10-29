import { resolve } from "node:path";

const BUILTIN: Record<string, { title: string; file: string; description: string }> = {
    full: { title: "Full", file: "SYSTEM_PROMPT_CORE.txt", description: "The complete prompt: every rule and convention inline." },
    lean: { title: "Lean", file: "SYSTEM_PROMPT_LEAN.txt", description: "Short prompt with the invariants; detail is read on demand from docs/agent-handbook.md." },
};

/**
 * Lists the named system prompts a person or an agent can choose from: built-in ones and saved ones.
 *
 * A named system prompt is the replaceable base of an agent's system prompt; tools, memory, canvas, plugins and the
 * runtime block are added to it on every turn either way. Built-ins (`full`, the complete prompt, and `lean`, the
 * short one) ship with the code; saved ones come from agent.saveSystemPrompt — a person's own (scope user) and
 * their project's (scope project). A saved name shadows a built-in one, project over user. Use to fill a prompt
 * picker, to check that a name exists, or (with `name`) to resolve one name to its text.
 * @param opts.userId Person whose own prompts are included; defaults to the agent's creator or the caller.
 * @param opts.projectId Project whose prompts are included; defaults to the agent's project.
 * @param opts.agentId Agent whose creator and project select the saved prompts.
 * @param opts.name Return only this name (an empty list when it does not exist).
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Person whose own prompts are included; defaults to the agent's creator or the caller. */
    userId?: string | null;
    /** Project whose prompts are included; defaults to the agent's project. */
    projectId?: string | null;
    /** Agent whose creator and project select the saved prompts. */
    agentId?: string;
    /** Return only this name (an empty list when it does not exist). */
    name?: string;
} = {}): Promise<Array<{ name: string; title: string; description: string; source: "builtin" | "user" | "project"; text: string; tokens: number }>> {
    let userId = opts.userId ?? null;
    let projectId = opts.projectId ?? null;
    if (opts.agentId && (!userId || !projectId)) {
        const row = ((await ctx.fns.procs.db.select({ sql: "SELECT created_by, project_id FROM agents WHERE id = ?", params: [opts.agentId] })) as any[])[0];
        userId ??= row?.created_by ?? null;
        projectId ??= row?.project_id ?? null;
    }
    userId ??= (session as any)?.user?.id ?? null;

    const out = new Map<string, { name: string; title: string; description: string; source: "builtin" | "user" | "project"; text: string; tokens: number }>();
    for (const [name, b] of Object.entries(BUILTIN)) {
        if (opts.name && opts.name !== name) continue;
        const text = await Bun.file(resolve(import.meta.dir, b.file)).text();
        out.set(name, { name, title: b.title, description: b.description, source: "builtin", text, tokens: Math.ceil(text.length / 4) });
    }
    const owners: Array<["user" | "project", string]> = [];
    if (userId) owners.push(["user", String(userId)]);
    if (projectId) owners.push(["project", String(projectId)]);
    for (const [scope, owner] of owners) {
        const rows = (await ctx.fns.procs.db.select({
            sql: `SELECT name, title, text FROM system_prompts WHERE scope = ? AND owner_id = ?${opts.name ? " AND name = ?" : ""} ORDER BY name`,
            params: opts.name ? [scope, owner, opts.name] : [scope, owner],
        })) as any[];
        for (const r of rows) out.set(r.name, { name: r.name, title: r.title || r.name, description: scope === "project" ? "Saved for the project" : "Your saved prompt", source: scope, text: r.text, tokens: Math.ceil(String(r.text).length / 4) });
    }
    return [...out.values()];
}
