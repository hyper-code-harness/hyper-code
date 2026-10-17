/**
 * Write a memory file (note, decision, page) on one of the four memory levels and index it
 *
 * Writes text to `~/.hyper/memory/…/<path>` and upserts its row in the `memory` table with title, description,
 * kind, content hash and source. Levels: `agent` (default, this agent only) → `agents/<id>/`; `user` (this
 * agent's person and all of their agents, in every project) → `users/<userId>/`; `project` (agents and people of
 * the project) → `projects/<slug>/`; `system` (everyone; only the instance owner's agents) → the root. Use for
 * prose someone reads and edits; use memory.put for many similar structured records. Code that should run is a
 * function file in `~/.hyper/src/<level>_<id>/`, not a memory file.
 * @param opts.path Relative path inside the level's folder, e.g. notes/canvas-url.md; absolute paths and '..' are rejected.
 * @param opts.content Full text content of the file.
 * @param opts.title Short human title shown in listings.
 * @param opts.description One line for the memory table of contents and search: what it is and when it applies.
 * @param opts.visibility Level: agent, user, project or system. @default agent
 * @param opts.kind Free-form kind chosen by the agent, e.g. decision, preference, fact, page.
 * @param opts.meta Extra metadata merged into meta, e.g. basis, status, tags.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Relative path inside the level's folder, e.g. notes/canvas-url.md; absolute paths and '..' are rejected. */
        path: string;
        /** Full text content of the file. */
        content: string;
        /** Short human title shown in listings. */
        title: string;
        /** One line for the memory table of contents and search: what it is and when it applies. */
        description: string;
        /** Level: agent, user, project or system. @default agent */
        visibility?: "agent" | "user" | "project" | "system";
        /** Free-form kind chosen by the agent, e.g. decision, preference, fact, page. */
        kind?: string;
        /** Extra metadata merged into meta, e.g. basis, status, tags. */
        meta?: Record<string, unknown>;
    },
): Promise<{ id: number; key: string; visibility: "agent" | "user" | "project" | "system"; type: "file" | "code"; path: string; url: string; version: number }> {
    const lv = await ctx.fns.memory.level({ visibility: opts.visibility, action: "memory.write" });
    const { resolve, relative, dirname, extname, isAbsolute } = await import("node:path");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const key = String(opts.path ?? "").replace(/^\.\/+/, "");
    const abs = resolve(lv.dir, key);
    const rel = relative(lv.dir, abs);
    if (!key || isAbsolute(key) || rel.startsWith("..")) throw new Error("memory.write: path must stay inside the memory folder");
    // The system root holds the other levels' folders; a system note must not land inside one of them.
    if (lv.visibility === "system" && /^(users|projects|agents)(\/|$)/.test(rel)) throw new Error("memory.write: users/, projects/ and agents/ are other levels' folders");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, opts.content);
    const type: "file" | "code" = [".ts", ".tsx", ".js", ".sh", ".py"].includes(extname(abs)) ? "code" : "file";
    const url = "file://" + abs;
    const now = Date.now();
    const meta = { ...(opts.meta ?? {}), hash: new Bun.CryptoHasher("sha256").update(opts.content).digest("hex"), size: Buffer.byteLength(opts.content), source: { agentId: lv.writer } };
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `insert into memory (visibility, project_id, user_id, agent_id, key, type, kind, title, description, url, meta, data, created_by, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, null, ?, ?, ?)
              on conflict (visibility, coalesce(project_id, ''), coalesce(user_id, ''), coalesce(agent_id, ''), key) do update set
                type = excluded.type, kind = excluded.kind, title = excluded.title, description = excluded.description, url = excluded.url,
                meta = memory.meta || excluded.meta, data = excluded.data, updated_at = excluded.updated_at, version = memory.version + 1
              returning id, version`,
        params: [lv.visibility, lv.projectId, lv.userId, lv.agentId, key, type, opts.kind ?? null, opts.title, opts.description, url, JSON.stringify(meta), lv.writer, now, now],
    });
    // Open memory pages (memory.view, memory.table — `@live memory`) re-fetch themselves.
    ctx.fns.procs.events.refresh({ topic: "memory", reason: "memory changed" });
    return { id: Number(rows[0].id), key, visibility: lv.visibility, type, path: abs, url, version: Number(rows[0].version) };
}
