/** Return the optional cached gap badge without invoking discovery or actions. */
export default async function(ctx:Context,_session:Session|null,_opts:{req:Request}):Promise<Response>{
 return new Response(await ctx.fns.ui.gapBadge({}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}
