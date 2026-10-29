// `<module>/$point_<name>.ts` — a module declaring an extension point it will
// run: `ui/$point_markdown.ts` declares `ui.markdown`. The file's default export is
// documentation for the point (what it is called with, what an answer means) —
// the framework only records that the point exists, which is what lets `dev.lint`
// tell a typo'd `$hook_` from a real one.
//
// `export default { family: true }` declares a FAMILY instead of one point:
// `services/$point_service.ts` then covers `services.service.aidbox`,
// `services.service.voice` and anything else a provider names itself — the
// open-ended case, where the point is a protocol and the suffix is who answers.
/**
 * Load loader point declarations into the runtime.
 * @param opts.entries The loader entries to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const points = ((ctx.state.procs.hooks ??= {}).points ??= {});
    for (const entry of opts.entries) {
        const name = `${entry.moduleDir.replaceAll("/", ".")}.${entry.name}`;
        const doc = entry.fn;
        points[name] = { module: entry.moduleDir.replaceAll("/", "."), rel: entry.rel, doc, family: doc?.family === true };
        ctx.fns.procs.log.debug({ event: "load.point", msg: name, from: `${entry.root}/${entry.rel}` });
    }
}
