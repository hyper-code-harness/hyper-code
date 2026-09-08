/** Same-origin, bounded form POST. HTMX receives one card; native navigation retains the shared shell. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request}) {
 const req=opts.req,url=new URL(req.url);
 if(req.headers.get('origin')!==url.origin || req.headers.get('sec-fetch-site')==='cross-site')return new Response('Same-origin form submission required',{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response('URL encoded form required',{status:415});
 const reader=req.body?.getReader();let body='';if(reader){const decoder=new TextDecoder();let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16384){await reader.cancel();return new Response('Form too large',{status:413});}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}
 const fields:Record<string,string>=Object.create(null);let html:string;
 try{for(const [key,value] of new URLSearchParams(body)){if(Object.hasOwn(fields,key)||value.length>2048)throw new Error('Duplicate or oversized field');fields[key]=value;}
 html=await ctx.fns.flow.submit({fields});
 }catch(error){html=await ctx.fns.flow.card({flow:fields.flow??'',gap:{id:fields.id??'',revision:fields.revision??'',summary:'Отправка не подтверждена.'},message:String(error instanceof Error?error.message:error),closed:true});}
 if(req.headers.get('hx-request')==='true')return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
 return {title:'Gaps',main:'<main id="gaps-page" class="mx-auto max-w-4xl p-6">'+html+'<a href="/gaps">Вернуться к списку</a></main>'};
}
