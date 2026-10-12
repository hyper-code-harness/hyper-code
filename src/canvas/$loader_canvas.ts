// `$canvas_<name>.ts` — a kind of tab an agent (or the person) can open on the canvas beside the chat.
// Default-export a types.canvas.Kind ({ render, prepare?, describe?, icon? }) and a named `hint` (a string, or a function of ctx when it depends on settings) saying
// what the kind shows and which args it takes. In the canvas module the kind is `<name>`; anywhere else it
// is `<module>.<name>` (docs/$canvas_note.ts → docs.note), so plugins cannot shadow each other. Only kinds
// in this catalog can be rendered: a tab names a kind, never an arbitrary function.

/**
 * Registers `$canvas_<name>.ts` kinds in ctx.state.canvas.kinds.
 * @param opts.entries The classified canvas-kind files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).canvas ??= {}) as types.canvas.State;
    const kinds = (state.kinds ??= {});
    for (const entry of opts.entries) {
        const short = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(short)) throw new Error(`${entry.rel}: $canvas_ name must be a kind such as file`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        const name = module === "canvas" ? short : `${module}.${short}`;
        const imported = entry.mod ?? await import(entry.abs + `?t=${Date.now()}`);
        const def = imported?.default;
        if (!def || typeof def.render !== "function") throw new Error(`${entry.rel}: $canvas_ file must default-export { render }`);
        const hint = imported.hint;
        if (hint !== undefined && typeof hint !== "string" && typeof hint !== "function") throw new Error(`${entry.rel}: $canvas_ hint must be a string or a function of ctx`);
        kinds[name] = { ...def, name, module, rel: entry.rel, hint };
        ctx.fns.procs.log.debug({ event: "load.canvas", msg: name, from: entry.rel });
    }
}
