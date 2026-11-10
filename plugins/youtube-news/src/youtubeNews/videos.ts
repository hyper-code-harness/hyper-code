/** Lists mirrored videos for one tracked YouTube channel. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Stable tracked channel key. */ key:string;
 /** Maximum videos returned. @default 30 @minimum 1 @maximum 200 */ limit?:number;
}):Promise<any[]>{await ctx.fns.youtubeNews.ensure({});return await ctx.fns.procs.db.select({sql:"SELECT video_id,title,description,published_at,url,transcript_source,transcript_lang,news_id,first_seen_at,last_seen_at FROM youtube_news.videos WHERE channel_key=? ORDER BY published_at DESC NULLS LAST LIMIT ?",params:[opts.key,Math.max(1,Math.min(200,opts.limit??30))]});}
