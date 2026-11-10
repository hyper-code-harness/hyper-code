/** Lists tracked YouTube channels with sync state and mirrored video counts. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Restrict results to enabled or disabled channels. */ enabled?:boolean;
}={}):Promise<any[]>{await ctx.fns.youtubeNews.ensure({});return await ctx.fns.procs.db.select({sql:`SELECT c.*,count(v.video_id)::int AS videos FROM youtube_news.channels c LEFT JOIN youtube_news.videos v ON v.channel_key=c.key WHERE (?::boolean IS NULL OR c.enabled=?) GROUP BY c.key ORDER BY c.label`,params:[opts.enabled??null,opts.enabled??null]});}
