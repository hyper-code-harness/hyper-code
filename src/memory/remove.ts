/**
 * Delete a memory entry: its index row and, for file/code entries, the file
 *
 * Finds a memory entry visible to the calling agent by id or key and deletes the index row; for file and code entries also deletes the file when it lies inside ~/.hyper/memory (function files are removed with their own file, not here). Use to drop duplicates and obsolete notes or records.
 * @param opts.id Memory row id; takes precedence over key.
 * @param opts.key Memory key, e.g. notes/old.md or todo/x.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory row id; takes precedence over key. */
        id?: number;
        /** Memory key, e.g. notes/old.md or todo/x. */
        key?: string;
    },
): Promise<{ id: number; key: string; fileRemoved: boolean }> {
    const found = await ctx.fns.memory.find({ id: opts.id, key: opts.key });
    if (!found) throw new Error(`memory entry not found: ${opts.id ?? opts.key}`);
    const r = found.row;
    if (!found.writable) throw new Error("memory.remove: system memory is changed only by the instance owner's agents");
    if (r.type === "code" && String(r.key).startsWith("fn/")) throw new Error("memory.remove: this is a function; delete its file and the index follows");
    let fileRemoved = false;
    if (r.type !== "jsonb" && found.path && await Bun.file(found.path).exists()) { const { rm } = await import("node:fs/promises"); await rm(found.path); fileRemoved = true; }
    await ctx.fns.procs.db.run({ sql: "delete from memory where id = ?", params: [r.id] });
    // Open memory pages (memory.view, memory.table — `@live memory`) re-fetch themselves.
    ctx.fns.procs.events.refresh({ topic: "memory", reason: "memory changed" });
    return { id: Number(r.id), key: r.key, fileRemoved };
}
