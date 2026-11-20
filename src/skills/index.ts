/**
 * Synchronizes the skill search index (`skill_docs`) with what is on disk: installed packs and the shared folders
 *
 * Use after anything that changes which skills exist — skills.install, skills.uninstall, an edit of a shared folder —
 * and at start. Reads every folder skills.sources lists, parses its SKILL.md (skills.parse), and upserts one row per
 * skill: name, pack, description, invocation policy, files, diagnostics, hash. Rows whose folder is gone are deleted.
 * The instructions themselves are not stored: activation reads the file, so an edited body is seen at once. Two skills
 * of one pack with the same name keep the first; the other is reported in `shadowed`. Embeddings are refreshed for
 * changed rows when an embeddings provider is on; a failure there is reported, not thrown.
 * @param opts.embed Compute embeddings for changed rows. @default true
 * @param opts.force Rewrite every row even when its folder did not change — after a change in how rows are built. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Compute embeddings for changed rows. @default true */
    embed?: boolean;
    /** Rewrite every row even when its folder did not change — after a change in how rows are built. @default false */
    force?: boolean;
} = {}): Promise<{ indexed: number; changed: number; deleted: number; skipped: Array<{ path: string; reason: string }>; shadowed: Array<{ id: string; path: string }>; embedded: number; failed?: string }> {
    const { basename } = await import("node:path");
    const { entries } = await ctx.fns.skills.sources({});
    const existing = new Map((await ctx.fns.procs.db.select({ sql: "SELECT id, content_hash, dir, trust, model_allowed, embedding IS NOT NULL AS has_embedding FROM skill_docs", params: [] }) as any[]).map(row => [String(row.id), row]));
    const skipped: Array<{ path: string; reason: string }> = [];
    const shadowed: Array<{ id: string; path: string }> = [];
    const seen = new Set<string>();
    const toEmbed: Array<{ id: string; text: string; hash: string }> = [];
    let changed = 0;
    const now = Date.now();
    for (const entry of entries) {
        const parsed = await ctx.fns.skills.parse({ path: entry.path, dirName: basename(entry.dir) });
        if (!parsed.ok) { skipped.push({ path: entry.path, reason: parsed.diagnostics.at(-1) ?? "not a skill" }); continue; }
        const id = `${entry.pack}:${parsed.name}`;
        if (seen.has(id)) { shadowed.push({ id, path: entry.path }); continue; }
        seen.add(id);
        const tree = await ctx.fns.skills.hashDir({ dir: entry.dir }).catch(() => ({ files: [] as string[], hash: "" }));
        // SKILL.md is the skill itself and agents/openai.yaml is Codex's metadata about it — neither is a resource to read.
        const files = tree.files.filter(file => file !== "SKILL.md" && file !== "agents/openai.yaml").slice(0, 300);
        // The row hash covers what a search or a list shows, so a moved folder or a changed trust level updates it too.
        const contentHash = tree.hash || parsed.hash;
        const old = existing.get(id);
        const same = opts.force !== true && old && old.content_hash === contentHash && old.dir === entry.dir && old.trust === entry.trust && Boolean(old.model_allowed) === entry.modelAllowed;
        const searchText = [parsed.name, entry.pack, parsed.description, ...parsed.body.split("\n").filter(line => /^#{1,3}\s/.test(line)).map(line => line.replace(/^#+\s*/, ""))].join("\n").slice(0, 8000);
        if (!same) {
            changed++;
            await ctx.fns.procs.db.run({
                sql: `INSERT INTO skill_docs (id, name, pack, source, trust, model_allowed, description, dir, model_invocable, user_invocable, argument_hint, files, diagnostics, body_chars, content_hash, search_text, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?)
                      ON CONFLICT (id) DO UPDATE SET name=excluded.name, pack=excluded.pack, source=excluded.source, trust=excluded.trust, model_allowed=excluded.model_allowed,
                        description=excluded.description, dir=excluded.dir, model_invocable=excluded.model_invocable, user_invocable=excluded.user_invocable, argument_hint=excluded.argument_hint,
                        files=excluded.files, diagnostics=excluded.diagnostics, body_chars=excluded.body_chars, content_hash=excluded.content_hash, search_text=excluded.search_text, updated_at=excluded.updated_at`,
                params: [id, parsed.name, entry.pack, entry.source, entry.trust, entry.modelAllowed, parsed.description, entry.dir, parsed.modelInvocable, parsed.userInvocable, parsed.argumentHint,
                    JSON.stringify(files), JSON.stringify(parsed.diagnostics), parsed.body.length, contentHash, searchText, now],
            });
        }
        if (!same || !old?.has_embedding) toEmbed.push({ id, text: searchText, hash: contentHash });
    }
    let deleted = 0;
    for (const id of existing.keys()) if (!seen.has(id)) deleted += (await ctx.fns.procs.db.run({ sql: "DELETE FROM skill_docs WHERE id = ?", params: [id] })).changes;

    let embedded = 0;
    let failed: string | undefined;
    if (opts.embed !== false && toEmbed.length) {
        try {
            const provider = await ctx.fns.embeddings.provider({});
            if (provider !== "off") {
                const result = await ctx.fns.embeddings.embed({ input: toEmbed.map(item => item.text) });
                for (let i = 0; i < toEmbed.length; i++) if (result.vectors[i]) {
                    await ctx.fns.procs.db.run({ sql: "UPDATE skill_docs SET embedding=?::public.halfvec, embedding_provider=?, embedding_model=? WHERE id=? AND content_hash=?", params: [JSON.stringify(result.vectors[i]), result.provider, result.model, toEmbed[i]!.id, toEmbed[i]!.hash] });
                    embedded++;
                }
            }
        } catch (error: any) { failed = String(error?.message ?? error).slice(0, 300); }
    }
    return { indexed: seen.size, changed, deleted, skipped, shadowed, embedded, ...(failed ? { failed } : {}) };
}
