/** GET /hyperhub/config — offline saved hub configuration. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
 return {title:'HyperHub configuration',main:await ctx.fns.hyperhub.configPage({})};
}
