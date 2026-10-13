/** Renders provider-neutral plugin source configuration links. */
export default async function(ctx:Context,_session:Session|null,_opts:{/** Incoming HTTP request. */req:Request}) {
 return {title:'Plugin sources',main:await ctx.fns.plugins.configPage({})};
}
