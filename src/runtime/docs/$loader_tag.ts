// `$tag_<name>.ts` — declares a function tag (types.runtime.docs.Tag): the JSDoc block tag `@<name>` on a
// runtime function. Any module or plugin may declare one; one declaration per name — a second module
// declaring the same name is refused, so a plugin cannot quietly redefine what `@view` means. The same file
// reloaded (hot reload) simply replaces its own declaration.

/**
 * Registers `$tag_<name>` declarations in ctx.state.tags.
 * @param opts.entries The classified tag files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const tags: Record<string, types.runtime.docs.RegisteredTag> = ((ctx.state as any).tags ??= {});
    for (const entry of opts.entries) {
        const name = String(entry.name ?? "");
        if (!/^[a-z][a-zA-Z0-9-]*$/.test(name)) throw new Error(`${entry.rel}: $tag_ name must look like view or live`);
        const def: any = (entry.mod ?? await import(String(entry.abs) + `?t=${Date.now()}`))?.default;
        if (!def || typeof def !== "object") throw new Error(`${entry.rel}: $tag_ file must default-export an object`);
        if (!String(def.summary ?? "").trim()) throw new Error(`${entry.rel}: $tag_ needs a summary`);
        if (def.arg !== undefined && !/^[a-z][a-zA-Z0-9-]*$/.test(String(def.arg))) throw new Error(`${entry.rel}: $tag_ arg must be a word such as topic or kind`);
        const rel = String(entry.projectRel ?? entry.rel);
        const owner = tags[name];
        if (owner && owner.rel !== rel) throw new Error(`${rel}: tag @${name} is already declared by ${owner.rel}`);
        const module = entry.moduleDir === "." ? "app" : String(entry.moduleDir).replaceAll("/", ".");
        tags[name] = { summary: String(def.summary).trim(), ...(def.arg ? { arg: String(def.arg) } : {}), ...(def.repeatable ? { repeatable: true } : {}), name, module, rel };
        ctx.fns.procs.log.debug({ event: "load.tag", msg: name, from: rel });
    }
}
