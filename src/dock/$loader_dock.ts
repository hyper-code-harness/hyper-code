// `$dock_<name>.ts` / `$dock_<name>.json` — an entry in the left Dock.
// A .ts default-exports a types.dock.Item ({ zone?, order?, render }), a .json holds { icon, label, href,
// zone?, order? } for a plain link. Id is `<module>.<name>` (mentions/$dock_mentions.ts → mentions.mentions;
// in the dock module itself just `<name>`), so plugins cannot shadow each other.

/**
 * Registers `$dock_<name>` entries in ctx.state.dock.items.
 * @param opts.entries The classified Dock entry files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).dock ??= {});
    const items: Record<string, types.dock.Registered> = (state.items ??= {});
    for (const entry of opts.entries) {
        const short = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(short)) throw new Error(`${entry.rel}: $dock_ name must look like mentions or quota`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const id = module === "dock" ? short : `${module}.${short}`;
        const path = String(entry.abs ?? "");
        const def: any = path.endsWith(".json")
            ? JSON.parse(await Bun.file(path).text())
            : (entry.mod ?? await import(path + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object") throw new Error(`${entry.rel}: $dock_ file must default-export an object`);
        if (def.zone !== undefined && def.zone !== "top" && def.zone !== "bottom") throw new Error(`${entry.rel}: $dock_ zone must be "top" or "bottom"`);
        if (def.order !== undefined && !Number.isFinite(Number(def.order))) throw new Error(`${entry.rel}: $dock_ order must be a number`);
        if (typeof def.render !== "function") {
            if (!def.label || !String(def.href ?? "").startsWith("/") || String(def.href).startsWith("//")) throw new Error(`${entry.rel}: $dock_ entry needs render() or { icon, label, href } with a local href`);
            if (def.icon && !/^ph-[a-z0-9-]+$/.test(String(def.icon))) throw new Error(`${entry.rel}: $dock_ icon must be a Phosphor class such as ph-clock`);
        }
        items[id] = { ...def, id, module, rel: entry.rel };
        ctx.fns.procs.log.debug({ event: "load.dock", msg: id, from: entry.rel });
    }
}
