/** Synchronizes every enabled YouTube channel in catalogue order. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Maximum newest videos inspected per channel. @default 20 @minimum 1 @maximum 50 */ limit?:number;
 /** Store video state without publishing to News. @default false */ dryRun?:boolean;
 /** Do not fetch YouTube subtitles. @default false */ skipTranscript?:boolean;
}={}):Promise<Array<Record<string,any>>>{const out:any[]=[];for(const channel of await ctx.fns.youtubeNews.list({enabled:true})){try{out.push(await ctx.fns.youtubeNews.sync({key:channel.key,limit:opts.limit,dryRun:opts.dryRun,skipTranscript:opts.skipTranscript}))}catch(error:any){out.push({key:channel.key,error:String(error?.message??error)})}}return out;}
