/** Fetches upstream and returns the compact left-rail update badge. */
export default async function(ctx:Context,_session:Session|null,_opts:{req:Request;params:Record<string,string>}) {
    const status=await ctx.fns.update.check({fetch:true});
    return new Response(await ctx.fns.ui.updateBadge({status}),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
