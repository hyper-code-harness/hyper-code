type SetOpts = {
    /** Setting namespace. */
    module: string;
    /** Scope category. */
    scopeType: string;
    /** Optional scope identifier. */
    scopeId?: string | null;
    /** Setting key to write. */
    key: string;
    /** JSON-serializable setting value. */
    value: any;
    /** Whether the stored row should be marked secret. */
    isSecret?: boolean;
};

/** Creates or updates one persisted setting override; refuses an instance (global) key fixed by a $settings_ file. */
export default async function (ctx: Context, _session: Session | null, opts: SetOpts): Promise<{ ok: true }> {
    if (opts.scopeType === 'global' && !opts.scopeId) {
        const fixed = (await ctx.fns.settings.files({})).values[`${opts.module}.${opts.key}`];
        if (fixed) throw new Error(`${opts.module}.${opts.key} is fixed by ${fixed.path} — change it in that file (one place per value)`);
    }
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO settings (module, scope_type, scope_id, key, value, is_secret, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(module, scope_type, scope_id, key)
         DO UPDATE SET
            value = excluded.value,
            is_secret = excluded.is_secret,
            updated_at = excluded.updated_at`,
        params: [
            opts.module,
            opts.scopeType,
            opts.scopeId ?? '',
            opts.key,
            JSON.stringify(opts.value),
            opts.isSecret ? 1 : 0,
            now,
        ],
    });
    if (opts.module === "embeddings" || (opts.module === "llm" && opts.key === "openaiApiKey")) {
        queueMicrotask(() => (ctx.fns as any).runtime?.docs?.index?.({ force: opts.module === "embeddings" }).catch((error: any) =>
            ctx.fns.procs.log.warn({ event: "runtime.docs.index.failed", msg: String(error?.message ?? error) })));
    }
    return { ok: true };
}
