// `$search_<name>.ts` — a search source for the global menu (⌘/). Default-exports types.nav.Search.
// Id is `<module>.<name>` (knowledge/$search_people.ts → knowledge.people; in the nav module just `<name>`).

/**
 * Registers `$search_<name>` files in ctx.state.nav.search.
 * @param opts.entries The classified search source files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).nav ??= {});
    const sources: Record<string, types.nav.Search & types.nav.Registered> = (state.search ??= {});
    for (const entry of opts.entries) {
        const short = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(short)) throw new Error(`${entry.rel}: $search_ name must look like people or chats`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const id = module === "nav" ? short : `${module}.${short}`;
        const def: any = (entry.mod ?? await import(String(entry.abs) + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object") throw new Error(`${entry.rel}: $search_ file must default-export an object`);
        if (!String(def.title ?? "").trim()) throw new Error(`${entry.rel}: $search_ needs a title`);
        if (typeof def.search !== "function") throw new Error(`${entry.rel}: $search_ needs search()`);
        if (def.icon !== undefined && !/^ph-[a-z0-9-]+$/.test(String(def.icon))) throw new Error(`${entry.rel}: $search_ icon must be a Phosphor class such as ph-user`);
        if (def.prefix !== undefined && !/^[^\sA-Za-z0-9]$/.test(String(def.prefix))) throw new Error(`${entry.rel}: $search_ prefix must be one symbol such as @ or #`);
        if (def.order !== undefined && !Number.isFinite(Number(def.order))) throw new Error(`${entry.rel}: $search_ order must be a number`);
        sources[id] = { ...def, id, module, rel: entry.rel };
        ctx.fns.procs.log.debug({ event: "load.search", msg: id, from: entry.rel });
    }
}
