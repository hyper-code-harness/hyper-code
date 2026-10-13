/**
 * Download a resumable batch of authenticated Tidy First posts to a local Markdown archive
 *
 * Reads subscribed posts through substack.post and verifies the browser API body against word count and paywall markers. Saves raw HTML, Markdown and an atomic per-post manifest without publishing. Stops on systemic access failures.
 * @param opts.limit Maximum pending posts to process in this batch. @default 20 @minimum 1 @maximum 448
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Maximum pending posts to process in this batch. @default 20 @minimum 1 @maximum 448 */
        limit?: number;
    },
): Promise<{processed:number;counts:Record<string,number>;blocked:string|null}> {
    const fs=await import('node:fs/promises');
    const root='/Users/niquola/kent beck/articles/tidyfirst';
    const manifest=JSON.parse(await fs.readFile(root+'/manifest.json','utf8'));
    let processed=0;let blocked:string|null=null;
    for(const e of manifest.entries.filter((e:{status:string;raw_html?:string})=>e.status==='pending'||!e.raw_html&&e.status==='full').slice(0,opts.limit??20)){
     try{
      let post;
      try { post=await ctx.fns.substack.post({host:new URL(e.url).hostname,slug:e.slug}); }
      catch (error) {
        if (!String(error).includes('HTTP 404')) throw error;
        await ctx.fns.browser.navigate({session:'substack',url:e.url,settleMs:1500});
        post=await ctx.fns.browser.evaluate({session:'substack',expression:'(()=>{const p=window._preloads?.post;if(!p?.body_html)throw new Error("No post body on canonical page");return {title:p.title,subtitle:p.subtitle,date:p.post_date,audience:p.audience,bodyLength:p.body_html.length};})()'});
      }
      const data=await ctx.fns.browser.evaluate({session:'substack',awaitPromise:true,expression:
       'fetch('+JSON.stringify('/api/v1/posts/'+encodeURIComponent(e.slug))+',{headers:{accept:"application/json"}}).then(async r=>{if(!r.ok)throw new Error("HTTP "+r.status);const p=await r.json();const doc=new DOMParser().parseFromString(p.body_html||"","text/html");const images=[...doc.images].map(i=>({url:i.getAttribute("src"),alt:i.alt,status:"external"}));function walk(n){if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return "";const t=n.tagName.toLowerCase();if(["script","style","button"].includes(t))return "";const s=[...n.childNodes].map(walk).join("");if(/^h[1-6]$/.test(t))return "\\n\\n"+"#".repeat(Number(t[1]))+" "+s+"\\n\\n";if(t==="img")return "!["+(n.getAttribute("alt")||"").replace(/]/g,"")+"]("+(n.getAttribute("src")||"")+")";if(t==="a")return "["+s+"]("+(n.getAttribute("href")||"")+")";if(t==="pre")return "\\n\\n~~~\\n"+n.textContent+"\\n~~~\\n\\n";if(t==="code")return "`"+s+"`";if(t==="strong"||t==="b")return "**"+s+"**";if(t==="em"||t==="i")return "*"+s+"*";if(t==="li")return "\\n- "+s.trim();if(t==="blockquote")return "\\n\\n> "+s.trim().replace(/\\n/g,"\\n> ")+"\\n\\n";if(t==="br")return "\\n";if(["p","div","figure","ul","ol","table","tr"].includes(t))return "\\n\\n"+s+"\\n\\n";return s;}return {html:p.body_html||"",markdown:walk(doc.body).replace(/\\n{3,}/g,"\\n\\n").trim(),images,wordcount:p.wordcount,actualWords:doc.body.textContent.trim().split(/\\s+/).length,previewLimit:p.post_preview_limit,geoblocked:p.is_geoblocked,freeUnlockRequired:p.free_unlock_required,paywall:!!doc.querySelector(".paywall,.paywall-container,[data-component-name=Paywall]"),type:p.type,media:{podcast:p.podcast_url||null,video:!!p.video_upload_id},truncatedLength:(p.truncated_body_text||"").length};})'});
      const reasons:string[]=[];
      if(!data.html)reasons.push('empty body');
      if(data.geoblocked)reasons.push('geoblocked');
      if(data.freeUnlockRequired)reasons.push('unlock required');
      if(data.paywall||/class=["'][^"']*paywall/i.test(data.html))reasons.push('paywall marker');
      if(data.wordcount>0 && data.actualWords<data.wordcount*0.88)reasons.push('body shorter than advertised word count');
      if(post.bodyLength!==data.html.length)reasons.push('inconsistent repeated body');
      e.status=!data.html?'unavailable':reasons.length?'partial':'full';
      e.verification={reasons,method:'Authenticated API body, no paywall marker, word-count comparison',wordcount:data.wordcount,actualWords:data.actualWords,previewLimit:data.previewLimit,bodyLength:data.html.length};
      e.media=data.media;e.images=data.images;e.fetched_at=new Date().toISOString();
      e.markdown=e.slug+'.md';e.raw_html=e.slug+'.html';
      await fs.writeFile(root+'/'+e.raw_html,data.html);
      const front={title:post.title,url:e.url,date:post.date,audience:post.audience,status:e.status,source:'tidyfirst',fetched_at:e.fetched_at};
      await fs.writeFile(root+'/'+e.markdown,'---\n'.replace(/\\n/g,'\n')+Object.entries(front).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n').replace(/\\n/g,'\n')+'\n---\n\n'.replace(/\\n/g,'\n')+'# '+post.title+'\n\n'.replace(/\\n/g,'\n')+(post.subtitle?post.subtitle+'\n\n'.replace(/\\n/g,'\n'):'')+data.markdown+'\n'.replace(/\\n/g,'\n'));
     }catch(err){e.status='error';e.error=String(err);e.fetched_at=new Date().toISOString();if(/HTTP (401|403|429)|captcha|cloudflare|session.*not|closed|timeout/i.test(e.error))blocked=e.error;}
     processed++;manifest.updated_at=new Date().toISOString();manifest.blocked=blocked;
     await fs.writeFile(root+'/manifest.json.tmp',JSON.stringify(manifest,null,2));await fs.rename(root+'/manifest.json.tmp',root+'/manifest.json');
     if(blocked)break;
     await Bun.sleep(650);
    }
    const counts:Record<string,number>={};for(const e of manifest.entries)counts[e.status]=(counts[e.status]??0)+1;
    return {processed,counts,blocked};
}
