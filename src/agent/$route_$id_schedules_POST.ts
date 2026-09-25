/** Creates or controls recurring prompt schedules for one agent. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}){
 const id=String(opts.params.id??""),form=await opts.req.formData(),action=String(form.get("action")??"add");
 try{
  if(action==="add"){
   const text=String(form.get("text")??"").trim(),every=String(form.get("every")??"").trim();if(!text)throw new Error("Prompt is required");
   const name=`agent:${id}:prompt:${crypto.randomUUID().slice(0,8)}`;
   await ctx.fns.cron.add({name,fn:"agent.injectScheduledPrompt",every,args:{agentId:id,text,scheduleId:name},now:form.get("now")==="1"});
  }else{
   const name=String(form.get("name")??"");if(!name.startsWith(`agent:${id}:prompt:`))throw new Error("Invalid schedule");
   if(action==="run")await ctx.fns.cron.runNow({name});
   else if(action==="pause")await ctx.fns.cron.setEnabled({name,enabled:false});
   else if(action==="resume")await ctx.fns.cron.setEnabled({name,enabled:true});
   else if(action==="delete")await ctx.fns.cron.remove({name});
   else throw new Error("Unsupported action");
  }
  ctx.fns.events.refreshAgentMeta({agentId:id,section:"automation",reason:"schedule-changed"});
  return new Response(null,{status:204,headers:{"HX-Trigger":"agent-meta-refresh"}});
 }catch(error:any){return new Response(String(error?.message??error),{status:400});}
}
