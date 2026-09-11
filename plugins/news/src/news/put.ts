/** Stores a prepared source-neutral News item, deduplicating cross-producer writes by canonical original URL while preserving reader state. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Stable source item identifier. */ id:string;
 /** Headline. */ title:string;
 /** Stable producer source key. */ source:string;
 /** Original article URL used for early cross-source deduplication. */ url?:string;
 /** Human-readable source name shown in the News UI. */ sourceLabel?:string;
 /** Public image URL displayed with the News item. */ imageUrl?:string;
 /** Author name. */ author?:string;
 /** Source score. */ points?:number;
 /** Source comment count. */ comments?:number;
 /** Topic labels. */ topics?:string[];
 /** Stored article Markdown supplied by the producer. */ articleMarkdown?:string;
 /** Prepared short summary. */ summary?:string;
 /** Prepared expanded summary. */ summaryLong?:string;
 /** Producer query or grouping key. */ query?:string;
 /** Source fetch timestamp. */ fetchedAt?:string;
 /** Publication/display timestamp. */ shownAt?:string;
}):Promise<{id:string;deduped?:boolean}>{await ctx.fns.news.ensure({});if(!opts.id?.trim()||!opts.title?.trim()||!opts.source?.trim())throw new Error("news.put requires id, title and source");const canonical=opts.url?ctx.fns.news.canonicalUrl({url:opts.url}):"",duplicate=canonical?(await ctx.fns.procs.db.select({sql:"SELECT id FROM news.items WHERE canonical_url=? OR (canonical_url IS NULL AND url IS NOT NULL AND lower(regexp_replace(regexp_replace(url,'^https?://(www\\.)?','','i'),'/+$',''))=?) ORDER BY (id=?) DESC,fetched_at LIMIT 1",params:[canonical,canonical,opts.id]}))[0]:null,id=duplicate?.id??opts.id,topicArray=opts.topics?.length?`{${opts.topics.map(x=>`"${String(x).replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`).join(",")}}`:null;await ctx.fns.procs.db.run({sql:`INSERT INTO news.items(id,title,url,canonical_url,image_url,author,points,comments,topics,article_md,summary,summary_long,query,source,source_label,fetched_at,shown_at) VALUES(?,?,?,?,?,?,?,?,?::text[],?,?,?,?,?,?,coalesce(?::timestamptz,now()),?::timestamptz) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=coalesce(excluded.url,news.items.url),canonical_url=coalesce(excluded.canonical_url,news.items.canonical_url),image_url=coalesce(excluded.image_url,news.items.image_url),author=coalesce(excluded.author,news.items.author),points=greatest(coalesce(excluded.points,news.items.points),coalesce(news.items.points,excluded.points)),comments=greatest(coalesce(excluded.comments,news.items.comments),coalesce(news.items.comments,excluded.comments)),topics=coalesce(excluded.topics,news.items.topics),article_md=coalesce(excluded.article_md,news.items.article_md),summary=coalesce(news.items.summary,excluded.summary),summary_long=coalesce(news.items.summary_long,excluded.summary_long),query=coalesce(excluded.query,news.items.query),source_label=coalesce(news.items.source_label,excluded.source_label),shown_at=coalesce(news.items.shown_at,excluded.shown_at)`,params:[id,opts.title,opts.url??null,canonical||null,opts.imageUrl??null,opts.author??null,opts.points??null,opts.comments??null,topicArray,opts.articleMarkdown??null,opts.summary??null,opts.summaryLong??null,opts.query??null,opts.source,opts.sourceLabel??null,opts.fetchedAt??null,opts.shownAt??null]});return{id,deduped:id!==opts.id||undefined};}
