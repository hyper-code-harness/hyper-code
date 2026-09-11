/** Forgets a closed named browser-session tombstone so the next navigation may create a fresh background tab. */
export default function(ctx:Context,_session:Session|null,opts:{
 /** Logical browser session name to forget. */ session:string;
}):{forgotten:boolean}{const sessions:Map<string,any>|undefined=(ctx.state as any).cdp?.sessions,entry=sessions?.get(opts.session);if(!entry)return{forgotten:false};try{entry.ws?.close()}catch{}sessions!.delete(opts.session);return{forgotten:true};}
