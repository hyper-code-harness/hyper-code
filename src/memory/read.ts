/**
 * Read one memory entry with its content: file text for file/code, data for jsonb
 *
 * Finds a memory entry visible to the calling agent by id, or by key (nearest level first: agent, project, user, system) and returns its index row plus content: the current file text for type file/code (read from the absolute file:// url) or the stored data for jsonb. Reports stale=true when the file changed outside memory.write (hash mismatch) or is missing.
 * @param opts.id Memory row id; takes precedence over key.
 * @param opts.key Key to look up when id is not given.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory row id; takes precedence over key. */
        id?: number;
        /** Key to look up when id is not given. */
        key?: string;
    },
): Promise<{ id: number; visibility: string; type: string; kind: string | null; key: string; title: string; description: string; url: string | null; meta: Record<string, unknown>; version: number; updatedAt: number; content: string | null; data: unknown; stale: boolean } | null> {
    const found = await ctx.fns.memory.find({ id: opts.id, key: opts.key });
    if (!found) return null;
    const r = found.row;
    let content: string | null = null, stale = false;
    if (r.type !== "jsonb" && found.path) {
        const f = Bun.file(found.path);
        if (await f.exists()) {
            content = await f.text();
            const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex");
            stale = !!r.meta?.hash && r.meta.hash !== hash;
        } else stale = true;
    }
    return { id: Number(r.id), visibility: r.visibility, type: r.type, kind: r.kind, key: r.key, title: r.title, description: r.description, url: r.url, meta: r.meta ?? {}, version: Number(r.version), updatedAt: Number(r.updated_at), content, data: r.data ?? null, stale };
}
