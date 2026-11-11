// Ask for a module: write it into WORKDIR/workspace.json and remount. Installing is a manifest edit — that is the whole
// design, so the project carries its own tools and a fresh checkout comes up
// with them.
//
//   modules.add({ name: "fhir-viewer" })                                  // platform, by name
//   modules.add({ name: "aidbox", config: { license: "…" } })             // configure a mounted one
/**
 * Add the modules subsystem operation.
 * @param opts.name The target name.
 * @param opts.git Refused: a plugin from a git repository is installed with plugins.install.
 * @param opts.path Refused: a private plugin is a folder in USER_PLUGINS, mounted from there without a declaration.
 * @param opts.config Configuration values to apply.
 */
export default async function (ctx: Context, _session: Session | null, opts: { name: string; git?: string; path?: string; config?: Record<string, any> }) {
    if (ctx.fns.procs.env.mode() === "prod") throw new Error("modules.add is dev-only (it loads third-party code)");
    const name = opts.name.trim();
    if (!name) throw new Error("modules.add: name is required");
    // hyper-code2: no clone and no mount of an arbitrary folder behind a manifest edit — a git plugin is a
    // reviewed clone in USER_PLUGINS, a private one a folder there. A `path` already written in package.json
    // or workspace.json is still read by discover: that is how the repository mounts its own plugins/.
    if (opts.path) throw new Error(`modules.add no longer mounts a folder by path: put the ${name} folder into USER_PLUGINS (it is mounted from there) and call plugins.reload({})`);
    if (opts.git) throw new Error(`modules.add no longer clones git repositories: install ${name} with plugins.install({ name: "${name}" }) from the plugin catalog`);

    const file = `${ctx.fns.procs.project.workdir({})}/workspace.json`;
    const manifest = await Bun.file(file).json().catch(() => ({} as any));
    // A project written before the rename says `plugins`; fold it into `modules`
    // on the way through rather than leaving two lists that disagree — everything
    // still READS the old key, nothing writes it any more.
    if (manifest.plugins) { manifest.modules = { ...manifest.plugins, ...manifest.modules }; delete manifest.plugins; }
    manifest.modules ??= {};
    manifest.modules[name] = { ...manifest.modules[name], ...opts.config };
    await Bun.write(file, JSON.stringify(manifest, null, 2) + "\n");

    const mounted = (await ctx.fns.procs.modules.reload({})).find((m: any) => m.name === name);
    if (!mounted) throw new Error(`"${name}" is declared but did not mount — no module by that name in the catalogue`);
    // A module and a skill are one directory read by two readers. Turning it on
    // for a project hands it to both: the host mounts it, and the agent working
    // in that project finds its SKILL.md under `.claude/skills`.
    await ctx.fns.procs.modules.link({ name }).catch((error: any) =>
        ctx.fns.procs.log.warn({ event: "module.link.failed", msg: `${name}: ${String(error?.message ?? error)}` }));
    // Providers the module ships become Services cards: track merges them from
    // modules.provides, then autostart anything new (same as boot startAll).
    // Only a host that supervises services has this namespace; a module that
    // provides one is otherwise just mounted and left alone.
    if (!(ctx.fns as any).services) return { added: name, services: [] as string[] };
    await (ctx.fns as any).services.track({});
    for (const service of mounted.provides ?? []) {
        const record = (ctx.state as any).services?.records?.[service];
        if (!record || !record.spec.autostart) continue;
        if (record.state === "running" || record.state === "starting") continue;
        await (ctx.fns as any).services.start({ name: service }).catch((err: any) => {
            record.error = String(err?.message ?? err);
            record.state = "crashed";
            ctx.fns.procs.log.error({ event: "service.start.failed", msg: `${service}: ${record.error}`, service });
            ctx.fns.procs.events.emit({ event: { type: "service", name: service } });
        });
    }
    return mounted;
}
