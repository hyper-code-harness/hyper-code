/**
 * Previews or confirms one plugin change from the catalog page: install or update by name (plugins.install, with the
 * plugins it requires; version, branch or commit pick the ref), remove (plugins.uninstall, force=true for a clone with local work) or rollback to the previous release (plugins.gitInstall). Same-origin URL-encoded forms only; a request
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
    const allowed = ['operation', 'name', 'version', 'branch', 'commit', 'digest', 'confirmed', 'force'];
    if ([...form.keys()].some(k => !allowed.includes(k)) || allowed.some(k => form.getAll(k).length > 1))
        return new Response('Invalid fields', { status: 400 });
    const operation = form.get('operation');
    const name = form.get('name') ?? '';
    const embed = new URL(req.url).searchParams.get('embed') === '1' ? { embed: true } : {};
    const confirm = form.get('confirmed') === 'true' ? { confirmed: true, expectedDigest: form.get('digest') ?? '' } : {};
    try {
        const change = operation === 'install'
            ? await ctx.fns.plugins.install({ name, ...(form.get('version') ? { version: form.get('version')! } : {}), ...(form.get('branch') ? { branch: form.get('branch')! } : {}), ...(form.get('commit') ? { commit: form.get('commit')! } : {}), ...confirm })
            : operation === 'remove'
                ? await ctx.fns.plugins.uninstall({ name, ...(form.get('force') === 'true' ? { force: true } : {}), ...confirm })
                : operation === 'rollback'
                    ? await ctx.fns.plugins.gitInstall({ operation: 'rollback', name, ...confirm })
                    : null;
        if (!change) return new Response('Invalid operation', { status: 400 });
        return { title: 'Plugin catalog', main: await ctx.fns.plugins.listingPage({ change, ...embed }) };
    } catch (error) {
        return { title: 'Plugin catalog', main: await ctx.fns.plugins.listingPage({ error: error instanceof Error ? error.message : 'Operation failed', ...embed }) };
    }
}
