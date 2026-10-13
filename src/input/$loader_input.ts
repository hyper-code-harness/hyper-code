// `$input_<kind>.ts` — a kind of form an agent can put into the chat and wait
// for (secret, confirm, choice, grid, …). Any module or plugin may declare one:
// default-export a types.input.Kind and a named `hint` that tells agents what
// the kind is for and what its spec looks like. Later roots override earlier
// ones by name, so a plugin can replace a core kind.

/**
 * Registers `$input_<kind>.ts` definitions in ctx.state.input.kinds.
 * @param opts.entries The classified input-kind files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).input ??= {}) as types.input.State;
    const kinds = (state.kinds ??= {});
    for (const entry of opts.entries) {
        const name = String(entry.name ?? "").toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${entry.rel}: $input_ name must be a lower-case kind such as choice`);
        const imported = entry.mod ?? await import(entry.abs + `?t=${Date.now()}`);
        const def = imported?.default;
        if (!def || typeof def.open !== "function" || typeof def.submit !== "function" || typeof def.done !== "function") {
            throw new Error(`${entry.rel}: $input_ file must default-export { open, submit, done }`);
        }
        const hint = typeof imported.hint === "string" ? imported.hint : undefined;
        kinds[name] = { ...def, name, module: entry.moduleDir === "." ? "app" : String(entry.moduleDir), rel: entry.rel, hint };
        ctx.fns.procs.log.debug({ event: "load.input", msg: name, from: entry.rel });
    }
}
