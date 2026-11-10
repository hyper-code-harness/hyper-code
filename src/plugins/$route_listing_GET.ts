/** Shows the plugin catalog with search and install, update and remove actions. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request }) {
    const q = new URL(opts.req.url).searchParams.get('q')?.slice(0, 200).trim();
    return { title: 'Plugin catalog', main: await ctx.fns.plugins.listingPage(q ? { q } : {}) };
}
