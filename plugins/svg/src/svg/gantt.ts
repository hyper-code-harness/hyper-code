/**
 * Render dated JSON tasks and dependency arrows as a static UTC Gantt SVG.
 *
 * Use for up to 200 explicitly dated tasks and 500 dependency arrows. Dates are strict YYYY-MM-DD UTC; bars cover start to end, end exclusive, equal dates render a milestone line. Dependencies are visual references, not scheduling constraints; cycles are rejected. Auto-scaled day ticks, optional progress and wrapped estimated-width labels. Input order defines rows; crowded arrows may cross other rows. No calendars, scheduling, sections, Mermaid parsing or animation. Returns SVG pixel boxes, routes and time-axis geometry with stable input-derived element IDs, scoped to each SVG.
 * @param opts.tasks Ordered tasks. Unique nonblank IDs up to 128 characters; labels up to 300. start/end are valid YYYY-MM-DD UTC dates with end >= start. dependencies lists unique predecessor IDs. progress is a finite fraction 0–1, default 0.
 * @param opts.title Optional accessible heading up to 160 characters.
 * @param opts.width Canvas width in SVG pixels; height grows with task labels. @default 1100 @minimum 720 @maximum 2400
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ordered tasks. Unique nonblank IDs up to 128 characters; labels up to 300. start/end are valid YYYY-MM-DD UTC dates with end >= start. dependencies lists unique predecessor IDs. progress is a finite fraction 0–1, default 0. */
        tasks: Array<{ id: string; label: string; start: string; end: string; dependencies?: string[]; progress?: number }>;
        /** Optional accessible heading up to 160 characters. */
        title?: string;
        /** Canvas width in SVG pixels; height grows with task labels. @default 1100 @minimum 720 @maximum 2400 */
        width?: number;
    },
): Promise<{ svg:string; width:number; height:number; boxes:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number;progress:number;start:string;end:string;label:{x:number;y:number;lines:string[]}}>; routes:Array<{id:string;elementId:string;from:string;to:string;points:Array<{x:number;y:number}>}>; axis:{start:string;end:string;stepDays:number;ticks:Array<{date:string;x:number}>} }> {
    const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const valid=(s:string,n:number)=>{if(typeof s!=='string'||s.length>n||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(s))throw new Error('Invalid XML text or text limit exceeded');};
    const key=(s:string)=>Array.from(s,c=>c.codePointAt(0)!.toString(16)).join('-');
    const wrap=(s:string,n:number)=>s.split(/\r?\n/).flatMap(l=>l.match(new RegExp(`.{1,${n}}`,'gu'))??['']);
    const date=(s:string)=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error('Dates must be YYYY-MM-DD UTC');const n=Date.parse(s+'T00:00:00.000Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==s)throw new Error('Invalid calendar date');return n;};
    if(!Array.isArray(opts.tasks)||opts.tasks.length>200)throw new Error('tasks must contain at most 200 tasks');
    if(opts.title!==undefined)valid(opts.title,160);
    const width=opts.width??1100;if(!Number.isFinite(width)||width<720||width>2400)throw new Error('width must be finite, 720–2400');
    const ids=new Set<string>();
    const parsed=opts.tasks.map(t=>{if(!t||typeof t!=='object')throw new Error('Invalid task');valid(t.id,128);valid(t.label,300);if(!t.id.trim()||ids.has(t.id))throw new Error('Task IDs must be unique and nonblank');ids.add(t.id);const start=date(t.start),end=date(t.end);if(end<start)throw new Error('Task end precedes start');if(t.progress!==undefined&&(!Number.isFinite(t.progress)||t.progress<0||t.progress>1))throw new Error('progress must be 0–1');if(t.dependencies!==undefined&&(!Array.isArray(t.dependencies)||t.dependencies.length>200||new Set(t.dependencies).size!==t.dependencies.length))throw new Error('dependencies must be unique references, at most 200');return {...t,startMs:start,endMs:end};});
    let edgeCount=0;for(const t of parsed)for(const d of t.dependencies??[]){if(!ids.has(d)||d===t.id)throw new Error('Unknown or self dependency');if(++edgeCount>500)throw new Error('Limit: 500 dependencies');}
    const byId=new Map(parsed.map(t=>[t.id,t]));const active=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(active.has(id))throw new Error('Dependency cycle');if(done.has(id))return;active.add(id);for(const d of byId.get(id)!.dependencies??[])visit(d);active.delete(id);done.add(id);};for(const t of parsed)visit(t.id);
    const day=86400000;const min=parsed.length?Math.min(...parsed.map(t=>t.startMs)):0;const max=parsed.length?Math.max(...parsed.map(t=>t.endMs)):day;const span=Math.max(day,max-min);const left=292,right=width-28,plot=right-left;
    const scale=(n:number)=>left+(n-min)/span*plot;
    const titleLines=opts.title?wrap(opts.title,Math.floor((width-56)/8)):[];const top=titleLines.length?64+titleLines.length*18:36;let y=top+46;
    const boxes=parsed.map(t=>{const lines=wrap(t.label,29);const rowHeight=Math.max(48,lines.length*18+20);const b={id:t.id,elementId:`gantt-task-${key(t.id)}`,x:scale(t.startMs),y:y+(rowHeight-22)/2,width:Math.max(0,scale(t.endMs)-scale(t.startMs)),height:22,progress:t.progress??0,start:t.start,end:t.end,label:{x:28,y:y+(rowHeight-lines.length*18)/2+14,lines}};y+=rowHeight;return b;});
    const height=Math.max(160,y+28);const boxMap=new Map(boxes.map(b=>[b.id,b]));
    const routes=parsed.flatMap(t=>(t.dependencies??[]).map(d=>{const a=boxMap.get(d)!,b=boxMap.get(t.id)!;const x1=a.x+a.width,y1=a.y+a.height/2,x2=b.x,y2=b.y+b.height/2;const lane=Math.min(right+14,Math.max(x1,x2)+12);return {id:`${d.length}:${d}${t.id}`,elementId:`gantt-dependency-${key(d)}-to-${key(t.id)}`,from:d,to:t.id,points:[{x:x1,y:y1},{x:lane,y:y1},{x:lane,y:b.y-8},{x:Math.max(left-12,x2-10),y:b.y-8},{x:Math.max(left-12,x2-10),y:y2},{x:x2,y:y2}]};}));
    const intervals=Math.max(1,Math.floor(plot/110));const stepDays=Math.max(1,Math.ceil(span/day/intervals));const ticks:Array<{date:string;x:number}>=[];for(let n=min;n<=min+span;n+=stepDays*day)ticks.push({date:new Date(n).toISOString().slice(0,10),x:scale(n)});
    const text=(lines:string[],x:number,y:number,anchor='start')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#27272a" font-size="13">${lines.map((l,i)=>`<tspan x="${x}" dy="${i?18:0}">${esc(l)}</tspan>`).join('')}</text>`;
    const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter,Arial,sans-serif" role="img"><title>${esc(opts.title??'Gantt chart')}</title><rect width="${width}" height="${height}" fill="#ffffff"/>`];
    if(titleLines.length)parts.push('<path d="M28 24h32" stroke="#6384d5" stroke-width="3"/>',text(titleLines,28,48));
    if(!boxes.length)parts.push(text(['No tasks'],28,top+30));
    else for(const t of ticks)parts.push(`<path d="M${t.x} ${top+28}V${height-28}" stroke="#d4d4d8" stroke-width="0.6"/>`,`<text x="${t.x}" y="${top+14}" text-anchor="${t.x===left?'start':t.x>right-42?'end':'middle'}" font-size="11" fill="#71717a">${t.date}</text>`);
    for(const r of routes){const last=r.points[r.points.length-1]!;parts.push(`<g id="${r.elementId}" data-edge-id="${esc(r.id)}"><path d="${r.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}" fill="none" stroke="#85858d" stroke-width="1"/><path d="M${last.x-6} ${last.y-3}L${last.x} ${last.y}L${last.x-6} ${last.y+3}" fill="none" stroke="#6384d5"/></g>`);}
    for(const b of boxes){parts.push(`<g id="${b.elementId}" data-node-id="${esc(b.id)}">${text(b.label.lines,b.label.x,b.label.y)}<title>${esc(b.start)} → ${esc(b.end)} · ${Math.round(b.progress*100)}%</title>`);if(b.width===0)parts.push(`<path d="M${b.x} ${b.y}v${b.height}" stroke="#6384d5" stroke-width="3"/>`);else parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="3" fill="#f7f7f8" stroke="#d4d4d8"/>`,`<rect x="${b.x}" y="${b.y}" width="${b.width*b.progress}" height="${b.height}" rx="3" fill="#6384d5" fill-opacity="0.55"/>`);parts.push('</g>');}
    parts.push('</svg>');return {svg:parts.join(''),width,height,boxes,routes,axis:{start:new Date(min).toISOString().slice(0,10),end:new Date(min+span).toISOString().slice(0,10),stepDays,ticks}};
}
