/** POST /hyperhub/config — explicitly replace saved hubs after same-origin validation. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
 const origin=opts.req.headers.get('origin');
 if(!origin||origin!==new URL(opts.req.url).origin||opts.req.headers.get('sec-fetch-site')==='cross-site')return new Response('Same-origin request required',{status:403});
 try {
  const form=await opts.req.formData();const hubs:Array<{label:string;origin:string;enabled:boolean;repo?:string}>=[];
  const text=(k:string)=>{const v=form.get(k);if(v!==null&&typeof v!=='string')throw new Error('Invalid field');return v??'';};
  for(let i=0;i<8;i++){if(form.has('remove'+i))continue;const origin=text('origin'+i).trim();if(!origin)continue;hubs.push({label:text('label'+i),origin,enabled:form.has('enabled'+i),repo:text('repo'+i)});}
  await ctx.fns.hyperhub.saveHubs({hubs});return new Response(null,{status:303,headers:{Location:'/hyperhub/config'}});
 }catch {return new Response('Invalid hub configuration. Use at most eight unique credential-free HTTPS origins.',{status:400});}
}
