/** Routes legacy explicit search URLs into the main plugin catalogue. */
export default async function(_ctx:Context,_session:Session|null,opts:{/** Incoming search request. */req:Request}) {
 const url=new URL(opts.req.url),query=new URLSearchParams();for(const key of ['q','provider']){const value=url.searchParams.get(key);if(value)query.set(key,value.slice(0,500));}return new Response(null,{status:303,headers:{Location:'/plugins'+(query.size?'?'+query:'')}});
}
