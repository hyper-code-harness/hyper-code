/** Generates and stores a concise one-paragraph Russian summary for one News item. Use after a producer has written new or changed source content through `news.put`. */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Stable News item identifier previously passed to `news.put`. */
    id: string;
    /** Re-summarize an item that already has a generated summary. @default false */
    force?: boolean;
}): Promise<{id:string;summary:string;topics:string[];cached:boolean}> {
    await ctx.fns.news.ensure({});
    const item=(await ctx.fns.procs.db.select({sql:"SELECT id,title,summary,article_md,topics,resummarized_at FROM news.items WHERE id=?",params:[opts.id]}))[0];
    if(!item)throw new Error(`news.summarize: no item ${opts.id}`);
    if(item.resummarized_at&&!opts.force)return {id:item.id,summary:item.summary??"",topics:item.topics??[],cached:true};
    const source=String(item.article_md||item.summary||item.title||"").trim();
    if(!source)throw new Error(`news.summarize: no source text for ${opts.id}`);
    const root=globalThis as typeof globalThis&{__newsSummaryTail?:Promise<void>};const previous=root.__newsSummaryTail??Promise.resolve();let release!:()=>void;root.__newsSummaryTail=new Promise<void>(resolve=>{release=resolve});await previous.catch(()=>undefined);let result:any;
    const model="openai:gpt-4o-mini";
    try{for(let attempt=0;attempt<4;attempt++){try{result=await ctx.fns.llm.call({
        system:"Ты — технический редактор новостной ленты. Отвечай строго в указанном формате, без markdown и без дополнительных пояснений.",
        model,
        user:`Сделай краткое саммари материала на русском языке.\n\nTOPICS: 2-3 основные темы через запятую на английском, lowercase (например: ai, postgresql, security).\nSUMMARY: ровно один абзац из 1-3 коротких предложений. Передай только суть и важные факты или цифры. Пиши простым прагматичным языком, в третьем лице. Не используй мета-фразы «статья рассказывает», «автор пишет», «в материале». Не добавляй фактов, которых нет в исходнике.\n\nЗАГОЛОВОК: ${item.title}\n\nИСХОДНИК:\n${source.slice(0,14000)}`,
        temperature:0.1,
        max_tokens:350,
        sessionId:`news-summary:${item.id}`,
    });break}catch(error:any){const message=String(error?.message??error),transient=/\b429\b|rate.?limit|overloaded|temporar/i.test(message);if(!transient||attempt===3)throw error;await Bun.sleep(1500*2**attempt)}}}finally{release()}
    const text=String(result.text??"").trim();
    const topics=(text.match(/TOPICS?:\s*([^\n]+)/i)?.[1]??"").split(",").map((x:string)=>x.trim().toLowerCase().replace(/[^a-z0-9+#-]/g,"")).filter(Boolean).slice(0,4);
    let summary=(text.match(/SUMMARY:\s*([\s\S]+)/i)?.[1]??text.replace(/^\s*TOPICS?:[^\n]*\n?/i,"")).trim();
    summary=summary.replace(/\n+/g," ").replace(/\s+/g," ").trim();
    if(!summary)throw new Error(`news.summarize: model returned an empty summary for ${opts.id}`);
    const topicArray=topics.length?`{${topics.join(",")}}`:null;
    await ctx.fns.procs.db.run({sql:"UPDATE news.items SET summary=?,summary_long=NULL,topics=coalesce(?::text[],topics),resummarized_at=now() WHERE id=?",params:[summary,topicArray,item.id]});
    return {id:item.id,summary,topics:topics.length?topics:(item.topics??[]),cached:false};
}
