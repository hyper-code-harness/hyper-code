/** Resolves and stores one YouTube channel for incremental publication into News. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Stable lowercase catalogue key. */ key:string;
 /** YouTube channel ID, handle, or URL. */ channel:string;
 /** Human-readable source label; defaults to the YouTube channel title. */ label?:string;
 /** Include the channel in bulk synchronization. @default true */ enabled?:boolean;
}):Promise<{key:string;channelId:string;label:string}>{
 await ctx.fns.youtubeNews.ensure({});const key=String(opts.key??"").trim();if(!/^[a-z0-9][a-z0-9_-]*$/.test(key))throw new Error("youtubeNews.add: key must be lowercase letters, digits, underscore or hyphen");
 const channel:any=await ctx.fns.youtube.channel({id:opts.channel});const channelId=String(channel?.id??"").trim();if(!channelId)throw new Error(`youtubeNews.add: could not resolve ${opts.channel}`);const label=String(opts.label??channel.title??key).trim();
 await ctx.fns.procs.db.run({sql:`INSERT INTO youtube_news.channels(key,channel_id,handle,label,enabled,updated_at) VALUES(?,?,?,?,?,now()) ON CONFLICT(key) DO UPDATE SET channel_id=excluded.channel_id,handle=excluded.handle,label=excluded.label,enabled=excluded.enabled,updated_at=now()`,params:[key,channelId,channel.handle??null,label,opts.enabled!==false]});return {key,channelId,label};
}
