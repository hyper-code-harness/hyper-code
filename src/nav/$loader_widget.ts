// `$widget_<name>.ts` — a widget type for the global menu (⌘/) grid. Default-exports types.nav.Widget.
// Id is `<module>.<name>` (gcal/$widget_today.ts → gcal.today; in the nav module itself just `<name>`).

/**
 * Registers `$widget_<name>` files in ctx.state.nav.widgets.
 * @param opts.entries The classified widget files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).nav ??= {});
    const widgets: Record<string, types.nav.Widget & types.nav.Registered> = (state.widgets ??= {});
    const sizes = new Set(["S", "M", "L", "wide", "tall"]);
    for (const entry of opts.entries) {
        const short = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(short)) throw new Error(`${entry.rel}: $widget_ name must look like today or unread`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const id = module === "nav" ? short : `${module}.${short}`;
        const def: any = (entry.mod ?? await import(String(entry.abs) + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object") throw new Error(`${entry.rel}: $widget_ file must default-export an object`);
        if (!String(def.title ?? "").trim()) throw new Error(`${entry.rel}: $widget_ needs a title`);
        if (typeof def.render !== "function") throw new Error(`${entry.rel}: $widget_ needs render()`);
        if (def.icon !== undefined && !/^ph-[a-z0-9-]+$/.test(String(def.icon))) throw new Error(`${entry.rel}: $widget_ icon must be a Phosphor class such as ph-clock`);
        if (def.sizes !== undefined && (!Array.isArray(def.sizes) || !def.sizes.length || def.sizes.some((s: unknown) => !sizes.has(String(s))))) throw new Error(`${entry.rel}: $widget_ sizes must be a non-empty list of S, M, L, wide, tall`);
        if (def.ttl !== undefined && !(Number(def.ttl) >= 0)) throw new Error(`${entry.rel}: $widget_ ttl must be seconds >= 0`);
        widgets[id] = { ...def, id, module, rel: entry.rel };
        ctx.fns.procs.log.debug({ event: "load.widget", msg: id, from: entry.rel });
    }
}
