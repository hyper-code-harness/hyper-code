/**
 * Previews or confirms one plugin change from the catalog page: install or update by name (plugins.install, with the
 * plugins it requires), remove (plugins.uninstall) or rollback. Same-origin URL-encoded forms only; a request
 * without confirmed=true never changes anything.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request }) {
    const req = opts.req, origin = req.headers.get('origin');
    if (!origin || origin !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site')
        return new Response('Same-origin request required', { status: 403 });
    if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
        return new Response('URL-encoded form required', { status: 415 });
    const text = await req.text();
    if (text.length > 8192) return new Response('Request too large', { status: 413 });
    const form = new URLSearchParams(text);
    const allowed = ['operation', 'name', 'version', 'digest', 'confirmed'];
    if ([...form.keys()].some(k => !allowed.includes(k)) || allowed.some(k => form.getAll(k).length > 1))
        return new Response('Invalid fields', { status: 400 });
    const operation = form.get('operation');
    const name = form.get('name') ?? '';
    const embed = new URL(req.url).searchParams.get('embed') === '1' ? { embed: true } : {};
    const confirm = form.get('confirmed') === 'true' ? { confirmed: true, expectedDigest: form.get('digest') ?? '' } : {};
    try {
        const change = operation === 'install'
            ? await ctx.fns.plugins.install({ name, ...(form.get('version') ? { version: form.get('version')! } : {}), ...confirm })
            : operation === 'remove'
                ? await ctx.fns.plugins.uninstall({ name, ...confirm })
                : operation === 'rollback'
                    ? await ctx.fns.plugins.bunInstall({ operation: 'rollback', ...confirm })
                    : null;
        if (!change) return new Response('Invalid operation', { status: 400 });
        return { title: 'Plugin catalog', main: await ctx.fns.plugins.listingPage({ change, ...embed }) };
    } catch (error) {
        return { title: 'Plugin catalog', main: await ctx.fns.plugins.listingPage({ error: error instanceof Error ? error.message : 'Operation failed', ...embed }) };
    }
}
