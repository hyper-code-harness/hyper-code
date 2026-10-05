/** Applies one revision-bound target after cookie-bound CSRF validation, then refreshes all checks. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
 const form=await opts.req.formData();
 const csrf=form.get('_csrf');
 if(typeof csrf!=='string'||!await ctx.fns.auth.verifyCsrf({req:opts.req,token:csrf}))return new Response('Invalid CSRF token',{status:403});
 const value=(name:string)=>{const all=form.getAll(name);if(all.length!==1 || typeof all[0]!=='string')throw new Error('Invalid form field: '+name);return all[0];};
 let notice:string;
 try {const result=await ctx.fns.flow.reconcile({flow:value('flow'),mode:'apply',target:{id:value('id'),revision:value('revision')}});notice=`${result.status}; receipt ${result.id}${result.error?': '+result.error:''}`;}
 catch(error){notice='Action not confirmed: '+String(error instanceof Error?error.message:error);}
 await ctx.fns.flow.refreshCount({force:true});
 return {title:'Gaps',main:await ctx.fns.auth.csrfForms({req:opts.req,html:await ctx.fns.flow.page({notice})})};
}
