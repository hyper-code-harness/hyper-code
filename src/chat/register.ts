/**
 * Registers chat header part files (`$chatbadge_`, `$chatbutton_`, `$chatcard_`) in ctx.state.chat.parts.
 *
 * Called by the three chat loaders at boot and on reload. Validates each file's default export and gives it the
 * id `<module>.<name>` (just `<name>` in the chat module) so plugins cannot shadow each other.
 * @param opts.kind Which part kind the entries declare.
 * @param opts.entries The classified files to register.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Which part kind the entries declare. */
        kind: "badge" | "button" | "card";
        /** The classified files to register. */
        entries: any[];
    },
): Promise<void> {
    const state = ((ctx.state as any).chat ??= {});
    const parts: Record<string, types.chat.RegisteredPart> = (state.parts ??= {});
    const prefix = `$chat${opts.kind}_`;
    for (const entry of opts.entries) {
        const short = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(short)) throw new Error(`${entry.rel}: ${prefix} name must look like workspace or effort`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const id = module === "chat" ? short : `${module}.${short}`;
        const def: any = (entry.mod ?? await import(String(entry.abs) + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object") throw new Error(`${entry.rel}: ${prefix} file must default-export an object`);
        if (typeof def.render !== "function") throw new Error(`${entry.rel}: ${prefix} needs render()`);
        if (def.order !== undefined && !Number.isFinite(Number(def.order))) throw new Error(`${entry.rel}: ${prefix} order must be a number`);
        if (opts.kind === "card") {
            if (!String(def.title ?? "").trim()) throw new Error(`${entry.rel}: ${prefix} needs a title`);
            if (def.icon !== undefined && !/^ph-[a-z0-9-]+$/.test(String(def.icon))) throw new Error(`${entry.rel}: ${prefix} icon must be a Phosphor class such as ph-palette`);
            if (def.size !== undefined && def.size !== "S" && def.size !== "L") throw new Error(`${entry.rel}: ${prefix} size must be S or L`);
        }
        const existing = parts[id];
        if (existing && existing.kind !== opts.kind) throw new Error(`${entry.rel}: id ${id} is already a chat ${existing.kind}`);
        parts[id] = { ...def, id, kind: opts.kind, module, rel: entry.rel };
        ctx.fns.procs.log.debug({ event: `load.chat${opts.kind}`, msg: id, from: entry.rel });
    }
}
