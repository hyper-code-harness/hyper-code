// `$fence_<lang>.ts` — renders a ```<lang> block inside Markdown. Any module or
// plugin may declare one; the file default-exports
// `(ctx, session, { source, lang, info }) => html`. Later roots override earlier
// ones by language. Diagram languages ship as plugins (mermaid, reladraw), so
// turning a plugin off turns its fence back into a plain code block.

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
        const render = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        if (typeof render !== "function") throw new Error(`${entry.rel}: $fence_ file must default-export a render function`);
        fences[lang] = { lang, module: entry.moduleDir === "." ? "app" : String(entry.moduleDir), rel: entry.rel, render };
        ctx.fns.procs.log.debug({ event: "load.fence", msg: lang, from: entry.rel });
    }
}
