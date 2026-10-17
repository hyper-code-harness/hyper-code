/**
 * Sets `meta.status` of a memory entry visible to the calling agent, leaving its content untouched.
 *
 * Use to mark a user, project or agent function `ready` once it is described and tested (ready functions are
 * listed in the prompt block of every agent that can call them), back to `draft`, or to record any other
 * lifecycle state of a note or record. A function becomes `ready` only when its file has a JSDoc summary and
 * a test file `<fn>.test.ts` next to it. Looks the key up nearest level first, like memory.read.
 * @param opts.id Memory row id; takes precedence over key.
 * @param opts.key Memory key, e.g. `fn/project_hyperDesign.tables` or `notes/canvas-model.md`.
 * @param opts.status New status, e.g. `draft` or `ready`.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Memory row id; takes precedence over key. */
        id?: number;
        /** Memory key, e.g. `fn/project_hyperDesign.tables` or `notes/canvas-model.md`. */
        key?: string;
        /** New status, e.g. `draft` or `ready`. */
        status: string;
    },
): Promise<{ id: number; key: string; status: string }> {
    const status = String(opts.status ?? "").trim();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(status)) throw new Error("memory.setStatus: status must be a short lowercase word, e.g. draft or ready");
    const found = await ctx.fns.memory.find({ id: opts.id, key: opts.key });
    if (!found) throw new Error(`memory.setStatus: no visible entry ${opts.id ?? opts.key}`);
    if (!found.writable) throw new Error("memory.setStatus: system memory is changed only by the instance owner's agents");
    const r = found.row;
    if (status === "ready" && r.type === "code" && String(r.key).startsWith("fn/")) {
        if (!found.path) throw new Error("memory.setStatus: function file is outside ~/.hyper/src");
        const testPath = found.path.replace(/\.ts$/, ".test.ts");
        if (!(await Bun.file(testPath).exists())) throw new Error(`memory.setStatus: a ready function needs a test next to it: ${testPath}`);
        if (!String(r.description ?? "").trim() || r.description === r.meta?.name) throw new Error("memory.setStatus: a ready function needs a JSDoc summary (first line of the /** */ block)");
    }
    await ctx.fns.procs.db.run({ sql: "update memory set meta = meta || jsonb_build_object('status', ?::text), updated_at = ? where id = ?", params: [status, Date.now(), r.id] });
    return { id: Number(r.id), key: r.key, status };
}
