// `$fence_<lang>.ts` — renders a ```<lang> block inside Markdown. Any module or
// plugin may declare one; the file default-exports
// `(ctx, session, { source, lang, info }) => html`. Later roots override earlier
// ones by language. Diagram languages ship as plugins (mermaid, reladraw), so
// turning a plugin off turns its fence back into a plain code block.
//
// A named export `hint` (string, or a function of ctx for a fence that can be
// switched off) is what the system prompt advertises. Without it the fence
// still works but nobody is told it exists — which is the right default for a
// fence meant for a human writing a document rather than for an agent.

/**
 * Registers `$fence_<lang>.ts` renderers in ctx.state.markdown.fences.
 * @param opts.entries The classified fence files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const state = ((ctx.state as any).markdown ??= {}) as types.markdown.State;
    const fences = (state.fences ??= {});
    for (const entry of opts.entries) {
        const lang = String(entry.name ?? "").toLowerCase();
        if (!/^[a-z][a-z0-9+-]*$/.test(lang)) throw new Error(`${entry.rel}: $fence_ name must be a fence language such as mermaid`);
        // In dev the file is imported here; in a built world the manifest
        // already did it and handed over the whole module as entry.mod. The
        // module, not just the default, because `hint` is a named export.
        const imported = entry.mod ?? await import(entry.abs + `?t=${Date.now()}`);
        const render = imported?.default ?? entry.fn;
        if (typeof render !== "function") throw new Error(`${entry.rel}: $fence_ file must default-export a render function`);
        const hint = imported?.hint;
        if (hint !== undefined && typeof hint !== "string" && typeof hint !== "function") throw new Error(`${entry.rel}: $fence_ hint must be a string or a function of ctx`);
        fences[lang] = { lang, module: entry.moduleDir === "." ? "app" : String(entry.moduleDir), rel: entry.rel, render, hint };
        ctx.fns.procs.log.debug({ event: "load.fence", msg: lang, from: entry.rel });
    }
}
