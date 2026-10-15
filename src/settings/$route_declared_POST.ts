// Submit handler for the declared-settings form.
// Iterates form fields, calls settings.set per declared key (or settings.remove
// when the user clicked the per-row "reset" button). Returns the freshly-rendered
// form for an htmx outerHTML swap.
function parseForType(raw: string, type?: string): any {
    if (type === 'number')  return Number(raw);
    if (type === 'boolean') return raw === 'true' || raw === '1';
    return raw;
}

/** Handles the HTTP route declared POST endpoint. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const fd = await opts.req.formData();
    const registry: Map<string, any> | undefined = (ctx.state as any).settings?.registry;

    if (registry) {
        const resetTarget = fd.get('reset');
        if (typeof resetTarget === 'string' && resetTarget) {
            const dotIdx = resetTarget.indexOf('.');
            if (dotIdx > 0) {
                await ctx.fns.settings.remove({
                    module: resetTarget.slice(0, dotIdx),
                    scopeType: 'global',
                    key: resetTarget.slice(dotIdx + 1),
                });
            }
        } else {
            const fixed = (await ctx.fns.settings.files({})).values;
            for (const [regKey, descriptor] of registry.entries()) {
                if (fixed[regKey]) continue; // owned by an instance settings file
                const dotIdx = regKey.indexOf('.');
                if (dotIdx <= 0) continue;
                const module = regKey.slice(0, dotIdx);
                const key = regKey.slice(dotIdx + 1);

                const raw = fd.get(regKey);
                let value: any;
                if (descriptor.type === 'boolean') {
                    value = raw === 'true' || raw === '1' || raw === 'on';
                } else if (raw == null) {
                    continue;
                } else if (descriptor.type === 'secret' && raw === '') {
                    // Empty secret field = leave as-is.
                    continue;
                } else {
                    value = parseForType(String(raw), descriptor.type);
                    if (descriptor.type === 'enum' && Array.isArray(descriptor.options)
                        && !descriptor.options.includes(value)) continue;
                    if (descriptor.type === 'number' && !Number.isFinite(value)) continue;
                }

                // Skip writes that match what get() resolves to right now — keeps DB sparse.
                const current = await ctx.fns.settings.get({ module, scopeType: 'global', key });
                if (Object.is(current, value)) continue;

                await ctx.fns.settings.set({
                    module, scopeType: 'global', key, value,
                    isSecret: descriptor.type === 'secret',
                });
            }
        }
    }

    return new Response(await ctx.fns.settings.renderDeclaredForm({}), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}
