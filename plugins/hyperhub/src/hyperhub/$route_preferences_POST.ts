/** POST /hyperhub/preferences — save an explicitly submitted local registry preference without registry access. */
export default async function(ctx: Context, _session: Session | null, opts: {req: Request; params: Record<string,string>}) {
    const origin = opts.req.headers.get('origin');
    if (!origin || origin !== new URL(opts.req.url).origin || opts.req.headers.get('sec-fetch-site') === 'cross-site') return new Response('Same-origin request required', {status:403});
    try {
        const form = await opts.req.formData(), baseUrl = form.get('baseUrl');
        if (typeof baseUrl !== 'string') throw new Error('Invalid form');
        await ctx.fns.hyperhub.saveRegistryPreference({baseUrl});
        return new Response(null, {status:303, headers:{Location:'/hyperhub','Cache-Control':'no-store'}});
    } catch { return new Response('Could not save registry preference. Use a credential-free HTTPS origin or leave it empty to clear.', {status:400}); }
}
