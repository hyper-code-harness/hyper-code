/** Applies one revision-bound target after same-origin validation, then refreshes all checks. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
 const url=new URL(opts.req.url),origin=opts.req.headers.get('origin');
 if(origin!==url.origin || opts.req.headers.get('sec-fetch-site')==='cross-site') return new Response('Same-origin form submission required',{status:403});
 const form=await opts.req.formData();
 const value=(name:string)=>{const all=form.getAll(name);if(all.length!==1 || typeof all[0]!=='string')throw new Error('Invalid form field: '+name);return all[0];};
 let notice:string;
 try {const result=await ctx.fns.flow.reconcile({flow:value('flow'),mode:'apply',target:{id:value('id'),revision:value('revision')}});notice=`${result.status}; receipt ${result.id}${result.error?': '+result.error:''}`;}
 catch(error){notice='Action not confirmed: '+String(error instanceof Error?error.message:error);}
 return {title:'Gaps',main:await ctx.fns.flow.page({notice})};
}
