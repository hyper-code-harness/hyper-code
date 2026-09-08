/** Initialize the aggregate preview cache at boot without delaying HTTP startup. */
export default async function(ctx:Context,_session:Session|null,_opts?:{}):Promise<void>{
 queueMicrotask(()=>{void ctx.fns.flow.refreshCount({}).catch(()=>undefined);});
}
