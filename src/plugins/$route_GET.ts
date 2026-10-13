/** Renders the provider-neutral plugin catalogue or offline source inventory. */
export default async function(ctx:Context,_session:Session|null,opts:{/** Incoming HTTP request. */req:Request}) {
 const url=new URL(opts.req.url);return {title:'Plugins',main:await ctx.fns.plugins.page({q:url.searchParams.get('q')??undefined,provider:url.searchParams.get('provider')??undefined,tab:url.searchParams.get('tab')==='installed'?'installed':'catalog'})};
}
