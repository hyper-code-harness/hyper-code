/**
 * Unregisters a runtime function only after its source has been removed.
 *
 * Use after deleting a function and draining its callers. Refuses to unload functions still present in the project scan; does not stop existing invocations or remove persisted history.
 * @param opts.name Exact dotted runtime function name to unregister after deleting its source.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact dotted runtime function name to unregister after deleting its source. */
        name: string;
    },
): Promise<{ removed: boolean; name: string }> {
    const entries = await ctx.fns.procs.project.scan({});
    if (entries.some(entry => entry.kind === 'fn' && (entry.moduleDir.replaceAll('/', '.') + '.' + entry.runtimeName) === opts.name)) throw new Error('Function source still exists: ' + opts.name);
    const segments = opts.name.split('.');
    if (segments.some(part => !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Invalid runtime function name');
    let node = ctx.state.registry as Record<string, any>;
    for (const segment of segments.slice(0, -1)) { if (!node[segment] || typeof node[segment] !== 'object') return { removed: false, name: opts.name }; node = node[segment]; }
    const key = segments[segments.length - 1]!;
    const removed = Object.hasOwn(node, key) && typeof node[key] === 'function';
    if (removed) delete node[key];
    return { removed, name: opts.name };
}
