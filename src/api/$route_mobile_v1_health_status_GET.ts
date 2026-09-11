/** Returns server receipts and latest canonical Health data for the native sync status screen. */
export default async function(ctx:Context,_session:Session|null,_opts:{req:Request;params:Record<string,string>}){return Response.json({version:1,...await ctx.fns.applehealth.status({})})}
