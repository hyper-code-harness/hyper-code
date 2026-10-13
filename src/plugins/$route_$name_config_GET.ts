/** Redirects the legacy mounted-plugin settings URL to the unified plugin detail Settings tab. */
export default async function(ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */ req: Request;
    /** Route parameters containing the mounted plugin name. */ params: Record<string,string>;
}): Promise<Response> {
    if (!(await ctx.fns.plugins.list({})).some(plugin=>plugin.name===opts.params.name)) return new Response('Mounted plugin not found',{status:404});
    return new Response(null,{status:302,headers:{Location:'/plugins/'+encodeURIComponent(opts.params.name!)+'?tab=settings','Cache-Control':'no-store'}});
}
