/** Opens a preview-only plugin review after a bounded same-origin form request. */
export default async function(ctx:Context,_session:Session|null,opts:{/** Incoming review form request. */req:Request}) {
 const req=opts.req,origin=req.headers.get('origin');
 if(!origin||origin!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return new Response('Same-origin request required',{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response('URL-encoded form required',{status:415});
 try {
  const reader=req.body?.getReader();if(!reader)throw new Error('Missing body');let size=0,text='';const decoder=new TextDecoder();
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>32768){await reader.cancel();return new Response('Review request too large',{status:413});}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
  const form=new URLSearchParams(text);if([...form.keys()].some(k=>k!=='selection'&&k!=='operation')||form.getAll('selection').length!==1||form.getAll('operation').length!==1)throw new Error('Invalid fields');
  const encoded=form.get('selection')!;if(encoded.length>8192)throw new Error('Selection too large');const operation=form.get('operation');if(operation!=='install'&&operation!=='update'&&operation!=='rollback')throw new Error('Invalid operation');
  const result=await ctx.fns.plugins.startReview({selection:JSON.parse(encoded),operation});
  return new Response(null,{status:303,headers:{Location:'/agent/'+encodeURIComponent(result.id),'Cache-Control':'no-store'}});
 }catch{return new Response('Could not open plugin review. Return to Plugins and select a source again.',{status:400});}
}
