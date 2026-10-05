/** Displays all current gaps using read-only discovery; no receipts or business writes. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {return {title:'Gaps',main:await ctx.fns.auth.csrfForms({req:opts.req,html:await ctx.fns.flow.page({})})};}
