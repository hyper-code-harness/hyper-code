/** POST /hyperhub/review — explicit user request to open preview-only review agent, never activation. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
 const origin=opts.req.headers.get('origin');
 if(!origin || origin!==new URL(opts.req.url).origin || opts.req.headers.get('sec-fetch-site')==='cross-site') return new Response('Same-origin request required',{status:403});
 try {
  const form=await opts.req.formData();
  const get=(key:string)=>{const value=form.get(key);if(typeof value!=='string')throw new Error('Invalid form');return value;};
  const result=await ctx.fns.hyperhub.startReview({baseUrl:get('baseUrl'),repo:get('repo'),name:get('name'),commit:get('commit')});
  return new Response(null,{status:303,headers:{Location:'/agent/'+encodeURIComponent(result.id),'Cache-Control':'no-store'}});
 } catch {return new Response('Could not open plugin review. Return to HyperHub and select a pinned plugin again.',{status:400});}
}
