/**
 * Replace exact text inside a memory file and refresh its index entry
 *
 * Finds a file/code memory entry visible to the calling agent by id or key, replaces oldText with newText (must occur exactly once unless all=true), writes the file and updates hash, size and version in the index. Optionally updates title and description. Use for small corrections of notes instead of re-writing the whole file with memory.write; also clears stale after a manual edit.
 * @param opts.id Memory row id; takes precedence over key.
 * @param opts.key Memory key, e.g. notes/canvas-model.md.
 * @param opts.oldText Exact text to replace; omit together with newText to only refresh the index or change title/description.
 * @param opts.newText Replacement text. @default 
 * @param opts.all Replace every occurrence instead of requiring exactly one. @default false
 * @param opts.title New title for the index entry.
 * @param opts.description New one-line description for the index entry.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory row id; takes precedence over key. */
        id?: number;
        /** Memory key, e.g. notes/canvas-model.md. */
        key?: string;
        /** Exact text to replace; omit together with newText to only refresh the index or change title/description. */
        oldText?: string;
        /** Replacement text. @default  */
        newText?: string;
        /** Replace every occurrence instead of requiring exactly one. @default false */
        all?: boolean;
        /** New title for the index entry. */
        title?: string;
        /** New one-line description for the index entry. */
        description?: string;
    },
): Promise<{ id: number; key: string; version: number; replaced: number }> {
    const found = await ctx.fns.memory.find({ id: opts.id, key: opts.key });
    if (!found) throw new Error(`memory.edit: no visible entry ${opts.id ?? opts.key}`);
    const r = found.row;
    if (r.type === "jsonb") throw new Error("memory.edit: jsonb entries are updated with memory.put");
    if (!found.writable) throw new Error("memory.edit: system memory is changed only by the instance owner's agents — propose the change to your person");
    if (!found.path) throw new Error("memory.edit: file is outside the memory folders");
    let text = await Bun.file(found.path).text();
    let replaced = 0;
    if (opts.oldText != null) {
        replaced = text.split(opts.oldText).length - 1;
        if (replaced === 0) throw new Error("memory.edit: oldText not found");
        if (replaced > 1 && !opts.all) throw new Error(`memory.edit: oldText occurs ${replaced} times; pass all: true or more context`);
        text = text.split(opts.oldText).join(opts.newText ?? "");
        await Bun.write(found.path, text);
    }
    const meta = { hash: new Bun.CryptoHasher("sha256").update(text).digest("hex"), size: Buffer.byteLength(text) };
    const out: any[] = await ctx.fns.procs.db.select({ sql: "update memory set meta = meta || ?::jsonb, title = coalesce(?, title), description = coalesce(?, description), updated_at = ?, version = version + 1 where id = ? returning version",
        params: [JSON.stringify(meta), opts.title ?? null, opts.description ?? null, Date.now(), r.id] });
    // Open memory pages (memory.view, memory.table — `@live memory`) re-fetch themselves.
    ctx.fns.procs.events.refresh({ topic: "memory", reason: "memory changed" });
    return { id: Number(r.id), key: r.key, version: Number(out[0].version), replaced };
}
