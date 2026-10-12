/**
 * Collects `$attach_<source>.ts` producer declarations.
 *
 * A declaration owns one process-wide external event connection. Its `start`
 * method receives an AbortSignal and an `emit` callback; agent subscriptions
 * are durable rows and do not create additional producer connections.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const root = ((ctx.state as any).attachments ??= { declarations: {}, running: {} });
    root.declarations ??= {};
    for (const entry of opts.entries) {
        const declaration = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        if (!declaration || typeof declaration.start !== "function") {
            throw new Error(`${entry.rel}: $attach declaration requires { start({ ctx, emit, signal }) }`);
        }
        const source = String(entry.name ?? "").trim();
        if (!source) throw new Error(`${entry.rel}: attachment source is required`);
        root.declarations[source] = {
            ...declaration,
            source,
            events: Array.isArray(declaration.events) ? declaration.events.map(String) : [],
            sourceFile: entry.rel,
        };
    }
}
