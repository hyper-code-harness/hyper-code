/**
 * Render typed JSON scenarios with real phase bands, actor actions and directed messages
 *
 * Use for small ordered interaction sketches, not executable workflows or security protocol verification. Validates with scenarioValidate; reuses sequenceDiagram actor geometry. Nested phase bands enclose their steps, actions are boxes on actor lifelines, reply arrows are dashed, and every message visibly names its kind. Default quiet light styling with optional IBM-inspired sizing and palette, estimated text wrapping, stable encoded IDs scoped to the SVG. Empty scenarios and phases supported. Returns SVG-pixel geometry; no activation bars, checks, stops, conditions or branches.
 * @param opts.model JSON source of truth: ordered actors and message/action/phase steps, optional globally unique id and visible title. Maximum 30 actors, 200 total steps and eight phase levels; unknown fields rejected.
 * @param opts.theme Independent IBM-inspired geometry, padding, type and palette; no branded assets.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** JSON source of truth: ordered actors and message/action/phase steps, optional globally unique id and visible title. Maximum 30 actors, 200 total steps and eight phase levels; unknown fields rejected. */
        model: types.diagrams.Scenario;
        /** Independent IBM-inspired geometry, padding, type and palette; no branded assets. */
        theme?: 'default' | 'ibm-inspired';
    },
): Promise<{ svg:string; width:number; height:number; actors:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>; messages:Array<{id:string;elementId:string;from:string;to:string;kind:'request'|'reply'|'send'|'redirect';points:Array<{x:number;y:number}>;label:{x:number;y:number;lines:string[]}}>; actions:Array<{id:string;elementId:string;actor:string;x:number;y:number;width:number;height:number;lines:string[]}>; phases:Array<{id:string;elementId:string;depth:number;x:number;y:number;width:number;height:number;lines:string[]}>; lifelines:Array<{id:string;elementId:string;x:number;y1:number;y2:number}> }> {
    await ctx.fns.diagrams.scenarioValidate({model:opts.model});
        const model=opts.model;
        if(opts.theme!==undefined && !['default','ibm-inspired'].includes(opts.theme)) throw new Error('Unsupported scenario theme');
        const ibm=opts.theme==='ibm-inspired';
        const size=(n:number)=>ibm?Math.ceil(n/8)*8:n;
        // Reuse sequence participant sizing/order; phases/actions require their own rows.
        const base=await ctx.fns.diagrams.sequenceDiagram({participants:model.actors,messages:[],theme:opts.theme});
        const esc=(s:string)=>Bun.escapeHTML(s);
        const key=(s:string)=>Array.from(s).map(c=>c.codePointAt(0)!.toString(16)).join('-');
        const eid=(s:string)=>`scenario-${key(s)}`;
        const wrap=(s:string,n:number)=>{
            const chars=Array.from(s.replace(/[\n\r\t]/g,' '));const lines:string[]=[];
            while(chars.length>n){let cut=n;for(let i=n-1;i>0;i--)if(chars[i]===' '){cut=i+1;break;}lines.push(chars.splice(0,cut).join(''));}
            if(chars.length)lines.push(chars.join(''));return lines.length?lines:[''];
        };
        const text=(lines:string[],x:number,y:number,anchor='middle')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${ibm?'#161616':'#34343b'}" font-size="${ibm?14:13}">${lines.map((l,i)=>`<tspan x="${x}" dy="${i?18:0}">${esc(l)}</tspan>`).join('')}</text>`;
        const heading=model.title===undefined?[]:wrap(model.title,64);
        const top=size(heading.length*18);
        const actorHeight=size(Math.max(48,...model.actors.map(a=>wrap(a.label,24).length*18+(ibm?32:24))));
        const actors=base.boxes.map(b=>({...b,elementId:eid(b.id),x:b.x+80,y:b.y+top,height:actorHeight}));
        const byId=new Map(actors.map(a=>[a.id,a]));
        const width=Math.max(720,base.width+160);
        const messages:Array<{id:string;elementId:string;from:string;to:string;kind:'request'|'reply'|'send'|'redirect';points:Array<{x:number;y:number}>;label:{x:number;y:number;lines:string[]}}>=[];
        const actions:Array<{id:string;elementId:string;actor:string;x:number;y:number;width:number;height:number;lines:string[]}>=[];
        const phases:Array<{id:string;elementId:string;depth:number;x:number;y:number;width:number;height:number;lines:string[]}>=[];
        let y=Math.max(76+top,...actors.map(a=>a.y+a.height+32));
        const layout=(steps:types.diagrams.Scenario['steps'],depth:number)=>{
         for(const s of steps){
          if(s.type==='phase'){
           const lines=wrap(s.title,Math.max(24,Math.floor((width-48-depth*16)/8)));
           const band={id:s.id,elementId:eid(s.id),depth,x:12+depth*8,y,width:width-24-depth*16,height:0,lines};
           phases.push(band);y+=lines.length*18+26;layout(s.steps,depth+1);y+=16;band.height=y-band.y;y+=16;
          }else if(s.type==='action'){
           const actor=byId.get(s.actor)!;const lines=wrap(s.label,24);const height=size(lines.length*18+(ibm?32:20));
           actions.push({id:s.id,elementId:eid(s.id),actor:s.actor,x:actor.x,y,width:actor.width,height,lines});y+=height+28;
          }else{
           const a=byId.get(s.from)!,b=byId.get(s.to)!;const x1=a.x+a.width/2,x2=b.x+b.width/2;
           // Kind is explicitly visible: no hidden inference of request/redirect/send semantics.
           const lines=wrap(`${s.kind}: ${s.label}`,s.from===s.to?24:Math.max(24,Math.min(60,Math.floor(Math.abs(x2-x1)/8)-2)));
           y+=lines.length*18;
           const points=s.from===s.to?[{x:x1,y},{x:x1+212,y},{x:x1+212,y:y+28},{x:x1,y:y+28}]:[{x:x1,y},{x:x2,y}];
           messages.push({id:s.id,elementId:eid(s.id),from:s.from,to:s.to,kind:s.kind,points,label:{x:s.from===s.to?x1+12:(x1+x2)/2,y:y-lines.length*18+14,lines}});
           y+=s.from===s.to?72:44;
          }
         }
        };
        layout(model.steps,0);
        const height=y+28;
        const lifelines=actors.map(a=>({id:a.id,elementId:`scenario-lifeline-${key(a.id)}`,x:a.x+a.width/2,y1:a.y+a.height,y2:height-16}));
        const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="${ibm?'IBM Plex Sans,Arial,sans-serif':'Inter,Arial,sans-serif'}"${model.id===undefined?'':` id="${eid(model.id)}"`}><title>${esc(model.title??'Scenario diagram')}</title><rect width="${width}" height="${height}" fill="#ffffff"/>`];
        if(heading.length)parts.push(text(heading,28,24,'start'));
        for(const p of phases)parts.push(`<g id="${p.elementId}" data-phase-id="${esc(p.id)}"><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="${ibm?8:5}" fill="${p.depth%2?'#ffffff':'#f7f7f8'}" stroke="#d4d4d8"/>${text(p.lines,p.x+12,p.y+20,'start')}</g>`);
        for(const l of lifelines)parts.push(`<path id="${l.elementId}" d="M${l.x} ${l.y1}V${l.y2}" stroke="#d4d4d8" stroke-dasharray="5 5" fill="none"/>`);
        for(const m of messages){const last=m.points[m.points.length-1]!,prev=m.points[m.points.length-2]!;const sign=last.x>=prev.x?1:-1;parts.push(`<g id="${m.elementId}" data-message-id="${esc(m.id)}" data-kind="${m.kind}"><path d="${m.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${ibm?'#525252':'#85858d'}"${m.kind==='reply'?' stroke-dasharray="5 4"':''}/><path d="M${last.x-sign*7} ${last.y-4}L${last.x} ${last.y}L${last.x-sign*7} ${last.y+4}" fill="none" stroke="${ibm?'#0f62fe':'#6384d5'}"/>${text(m.label.lines,m.label.x,m.label.y,m.from===m.to?'start':'middle')}</g>`);}
        for(const a of actions)parts.push(`<g id="${a.elementId}" data-action-id="${esc(a.id)}"><rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${ibm?8:5}" fill="${ibm?'#f6f2ff':'#eef2fb'}" stroke="${ibm?'#8a3ffc':'#b6c6e8'}"/>${text(a.lines,a.x+a.width/2,a.y+24)}</g>`);
        for(const a of actors){const lines=wrap(model.actors.find(p=>p.id===a.id)!.label,24);parts.push(`<g id="${a.elementId}" data-actor-id="${esc(a.id)}"><rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${ibm?8:5}" fill="${ibm?'#edf5ff':'#f7f7f8'}" stroke="${ibm?'#0f62fe':'#d4d4d8'}"/>${text(lines,a.x+a.width/2,a.y+(a.height-lines.length*18)/2+14)}</g>`);}
        parts.push('</svg>');
        return {svg:parts.join(''),width,height,actors,messages,actions,phases,lifelines};
}
