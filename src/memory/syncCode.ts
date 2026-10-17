/**
 * Indexes user, project and agent functions from ~/.hyper/src into the `memory` table as `type = code` rows.
 *
 * Use after writing, editing or deleting a function file in `~/.hyper/src/user_<userId>/`, `project_<slug>/`
 * or `agent_<id>/` so `memory.list({ type: "code" })` and the prompt block see it (the dev watcher calls it on
 * save). One row per function, key `fn/<module>.<fn>`, on the level its folder names. Title and description
 * come from the first JSDoc paragraph, `meta` gets `name`, `params`, `returnType`, `hash`; `meta.status`
 * (`draft` until memory.setStatus makes it `ready`) is kept across syncs. Rows of deleted files and of folders
 * whose project or user no longer exists are removed.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ indexed: number; removed: number; functions: string[] }> {
    const home = await ctx.fns.memory.home({});
    const { resolve } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const srcDir = resolve(home, "src");
    const projects = new Map<string, string>((await ctx.fns.procs.db.select({ sql: "select id, slug from projects", params: [] }) as any[]).map(p => [p.slug, p.id]));

    type Found = { visibility: "user" | "project" | "agent"; projectId: string | null; userId: string | null; agentId: string | null; abs: string; name: string; text: string };
    const found = new Map<string, Found>();
    const files: string[] = existsSync(srcDir) ? await Array.fromAsync(new Bun.Glob("*/*.ts").scan({ cwd: srcDir, onlyFiles: true })) : [];
    for (const rel of files) {
        const [folder, file] = rel.split("/") as [string, string];
        if (file.endsWith(".test.ts") || file.endsWith(".d.ts") || file.startsWith("$") || /^[A-Z]/.test(file)) continue;
        const level = await ctx.fns.memory.fnLevel({ module: folder });
        if (!level) continue;
        const f: Found = { visibility: level.level, projectId: null, userId: null, agentId: null, abs: resolve(srcDir, rel), name: `${folder}.${file.replace(/\.ts$/, "")}`, text: "" };
        if (level.level === "project") { f.projectId = projects.get(level.owner) ?? null; if (!f.projectId) continue; }
        if (level.level === "user") f.userId = level.owner;
        if (level.level === "agent") f.agentId = level.owner;
        f.text = await Bun.file(f.abs).text();
        found.set(`${f.visibility}\0${f.projectId ?? f.userId ?? f.agentId}\0fn/${f.name}`, f);
    }

    const now = Date.now();
    for (const [, f] of found) {
        const doc = parseDoc(f.text);
        const meta = { status: "draft", name: f.name, params: doc.params, returnType: doc.returnType, hash: new Bun.CryptoHasher("sha256").update(f.text).digest("hex"), size: f.text.length };
        await ctx.fns.procs.db.run({
            sql: `insert into memory (visibility, project_id, user_id, agent_id, key, type, kind, title, description, url, meta, data, created_by, created_at, updated_at)
                  values (?, ?, ?, ?, ?, 'code', 'function', ?, ?, ?, ?::jsonb, null, ?, ?, ?)
                  on conflict (visibility, coalesce(project_id, ''), coalesce(user_id, ''), coalesce(agent_id, ''), key) do update set
                    title = excluded.title, description = excluded.description, url = excluded.url, updated_at = excluded.updated_at,
                    meta = memory.meta || (excluded.meta - 'status'),
                    version = memory.version + case when memory.meta->>'hash' = excluded.meta->>'hash' then 0 else 1 end`,
            params: [f.visibility, f.projectId, f.userId, f.agentId, `fn/${f.name}`, doc.title || f.name, doc.description, "file://" + f.abs, JSON.stringify(meta), f.agentId, now, now],
        });
    }
    const existing: any[] = await ctx.fns.procs.db.select({ sql: "select id, visibility, project_id, user_id, agent_id, key from memory where type = 'code' and key like 'fn/%'", params: [] });
    const gone = existing.filter(r => !found.has(`${r.visibility}\0${r.project_id ?? r.user_id ?? r.agent_id}\0${r.key}`));
    for (const r of gone) await ctx.fns.procs.db.run({ sql: "delete from memory where id = ?", params: [r.id] });
    return { indexed: found.size, removed: gone.length, functions: [...found.values()].map(f => f.name).sort() };
}

// First JSDoc block: line 1 = title, the rest of the first paragraph = description; @param names; return type.
function parseDoc(text: string): { title: string; description: string; params: string[]; returnType: string | null } {
    const block = /\/\*\*([\s\S]*?)\*\//.exec(text)?.[1] ?? "";
    const lines = block.split("\n").map(l => l.replace(/^\s*\*\s?/, "").trim());
    const body = lines.filter(l => !l.startsWith("@"));
    const title = body.find(Boolean) ?? "";
    const rest = body.slice(body.indexOf(title) + 1);
    const para: string[] = [];
    for (const l of rest) { if (!l && para.length) break; if (l) para.push(l); }
    const params = [...block.matchAll(/@param\s+opts\.(\w+)/g)].map(m => m[1]!);
    const returnType = /\)\s*:\s*Promise<([\s\S]*?)>\s*\{/.exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    return { title, description: para.length ? `${title} ${para.join(" ")}` : title, params, returnType };
}
