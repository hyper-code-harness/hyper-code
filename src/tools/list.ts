// Every declared tool, with the name the MODEL sees resolved.
//
// Registry keys are "<module>.<name>" and always unique. The wire name has to
// match /^[a-zA-Z0-9_-]+$/ for every provider, so a dot is not an option:
// a tool whose short name is claimed by exactly one module keeps it (`read`,
// `write`), and a collision disambiguates both sides to "<module>_<name>".
// Sorted by key, so the wire name a tool gets never depends on scan order —
// and neither does the prefix cache that has those definitions baked into it.
/**
 * Lists the declared model-callable tools with the wire name each gets
 *
 * Use wherever tools are offered, described or called (tools.schemas, tools.promptSection, tools.call). A tool's
 * `optIn` comes from its declaration unless ctx.state.tools.optIn overrides it for that key, which is how a module
 * rolls a tool out behind a setting.
 * @param opts.module Only tools declared by this module, e.g. `tools` or `skills`.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Only tools declared by this module, e.g. `tools` or `skills`. */ module?: string } = {},
): any[] {
    const registry: Map<string, any> = (ctx.state as any).tools?.registry ?? new Map();
    const all = [...registry.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));

    const claims = new Map<string, number>();
    for (const t of all) claims.set(t.name, (claims.get(t.name) ?? 0) + 1);

    // `optIn` of a declaration can be overridden at run time (ctx.state.tools.optIn, keyed like the registry): a module
    // that rolls a tool out behind a setting flips it there, and every reader of this list follows.
    const optIn: Record<string, boolean> = (ctx.state as any).tools?.optIn ?? {};
    const out = all.map(t => ({
        ...t,
        ...(t.key in optIn ? { optIn: optIn[t.key] } : {}),
        wireName: (claims.get(t.name) ?? 0) > 1 ? `${String(t.module).replaceAll(".", "_")}_${t.name}` : t.name,
    }));

    return opts?.module ? out.filter(t => t.module === opts.module) : out;
}
