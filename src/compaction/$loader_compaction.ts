// `$compaction_<provider>.ts` — how agents on one provider shrink their context.
// Any module or plugin may declare one; the file default-exports a
// types.compaction.Compactor. `$compaction_default.ts` answers every provider
// without its own file. Later roots override earlier ones by provider name, so
// a plugin or .hyper can replace the default or add a provider.

/**
 * Registers `$compaction_<provider>.ts` compactors in ctx.state.compaction.compactors.
 * @param opts.entries The classified compaction files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).compaction ??= {}) as types.compaction.State;
    const compactors = (state.compactors ??= {});
    for (const entry of opts.entries) {
        const provider = String(entry.name ?? "").toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw new Error(`${entry.rel}: $compaction_ name must be a provider such as codex, anthropic or default`);
        const compact = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        if (typeof compact !== "function") throw new Error(`${entry.rel}: $compaction_ file must default-export a compactor function`);
        compactors[provider] = { provider, module: entry.moduleDir === "." ? "app" : String(entry.moduleDir), rel: entry.rel, compact };
        ctx.fns.procs.log.debug({ event: "load.compaction", msg: provider, from: entry.rel });
    }
}
