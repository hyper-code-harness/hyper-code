// `$keymap_<name>.ts` — keyboard bindings that belong to the keymap <name> (default, or one a module ships).
// The file default-exports `{ extends?: "<other keymap>", bind: { "<keys>": Binding }, scopes?: { <scope>: { "<keys>": Binding } } }`
// where a Binding is "<command id>", { command, args?, inInput? } or null (unbind). `bind` is the global scope;
// a named scope (menu, …) works only while the page says it is active (window.hyperKeyScopes.<scope>()).
// Every module may add to a keymap: all files with the same <name> are layered, the keys module first,
// then the others in module order; a later module never silently takes a key an earlier one bound
// (keys.resolve reports it as a conflict). A keymap that extends another starts from it and may rebind
// or unbind (null) its keys. Commands themselves are registered in the browser (window.hyperCommands).

/**
 * Registers `$keymap_<name>` files in ctx.state.keys.maps.
 * @param opts.entries The classified keymap files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).keys ??= {});
    const maps: Record<string, Record<string, any>> = (state.maps ??= {});
    for (const entry of opts.entries) {
        const name = String(entry.name ?? "");
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${entry.rel}: $keymap_ name must look like default or vim`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const def: any = (entry.mod ?? await import(entry.abs + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object" || (!def.bind && !def.scopes)) throw new Error(`${entry.rel}: $keymap_ file must default-export { bind: { "<keys>": "<command>" } }`);
        if (def.extends !== undefined && typeof def.extends !== "string") throw new Error(`${entry.rel}: $keymap_ extends must be a keymap name`);
        const scopes: Record<string, Record<string, unknown>> = { global: def.bind ?? {}, ...(def.scopes ?? {}) };
        for (const [scope, table] of Object.entries(scopes)) {
            if (!/^[a-z][a-zA-Z0-9-]*$/.test(scope) || !table || typeof table !== "object") throw new Error(`${entry.rel}: scope "${scope}" must be a name with a table of bindings`);
            for (const [keys, value] of Object.entries(table)) {
                const ok = value === null || typeof value === "string" || (typeof value === "object" && typeof (value as any).command === "string"
                    && ((value as any).args === undefined || Array.isArray((value as any).args)));
                if (!ok) throw new Error(`${entry.rel}: binding "${keys}" (${scope}) must be a command id, { command, args?, inInput? } or null`);
            }
        }
        (maps[name] ??= {})[module] = { module, rel: entry.rel, extends: def.extends, scopes };
        ctx.fns.procs.log.debug({ event: "load.keymap", msg: `${name} ← ${module}`, from: entry.rel });
    }
}
