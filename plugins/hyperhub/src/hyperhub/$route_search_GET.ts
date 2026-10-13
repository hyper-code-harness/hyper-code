/** Redirects legacy HyperHub discovery URLs to its provider in the core catalogue. */
export default async function(_ctx:Context,_session:Session|null,opts:{/** Incoming legacy request. */req:Request;/** Legacy route parameters. */params:Record<string,string>}) {
 const old=new URL(opts.req.url).searchParams,p=new URLSearchParams({provider:'hyperhub'});for(const key of ['q','tab']){const value=old.get(key);if(value)p.set(key,value.slice(0,500));}return new Response(null,{status:303,headers:{Location:'/plugins?'+p,'Cache-Control':'no-store'}});
}
