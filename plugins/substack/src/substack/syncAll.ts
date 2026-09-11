/** Synchronizes every enabled Substack publication into News and always closes the temporary browser tab. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Maximum recent posts per publication. @default 30 @minimum 1 @maximum 500 */ max?:number;
 /** Temporary browser session closed after the run. @default substack-news-sync */ session?:string;
}={}):Promise<any[]>{const session=opts.session??"substack-news-sync",out:any[]=[];ctx.fns.browser.sessionForget({session});try{for(const p of(await ctx.fns.substack.list({})).filter((x:any)=>x.enabled)){try{out.push(await ctx.fns.substack.sync({key:p.key,max:opts.max,session}))}catch(error:any){out.push({key:p.key,error:String(error?.message??error)})}}}finally{try{await ctx.fns.browser.tabClose({session})}catch{}ctx.fns.browser.sessionForget({session})}return out;}
