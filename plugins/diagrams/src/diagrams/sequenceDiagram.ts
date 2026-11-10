/**
 * Render ordered JSON participants and directed messages as a static SVG sequence diagram
 *
 * .

Use for small interaction diagrams with participant boxes, lifelines, ordered messages, dashed returns and self-messages. No Mermaid parsing, fragments, activation bars or animation. Up to 30 participants and 200 messages. Labels wrap by estimated character width; input order defines placement. Stable encoded input IDs identify participant groups, message groups and lifelines, scoped to each SVG; returned geometry uses SVG pixels. Empty input produces an empty canvas. Default restrained light palette with optional IBM-inspired sizing and palette.
 * @param opts.participants Ordered participants with unique nonblank IDs up to 128 characters and labels up to 300 characters.
 * @param opts.messages Ordered directed messages with unique nonblank IDs up to 128 characters, valid participant refs and labels up to 300 characters. Same from/to creates a self-message. dashed defaults to false; use true for returns.
 * @param opts.title Optional accessible heading up to 160 characters.
 * @param opts.theme Pre-layout geometry and visual preset; IBM-inspired is an independent interpretation without IBM assets.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ordered participants with unique nonblank IDs up to 128 characters and labels up to 300 characters. */
        participants: Array<{ id: string; label: string }>;
        /** Ordered directed messages with unique nonblank IDs up to 128 characters, valid participant refs and labels up to 300 characters. Same from/to creates a self-message. dashed defaults to false; use true for returns. */
        messages: Array<{ id: string; from: string; to: string; label: string; dashed?: boolean }>;
        /** Optional accessible heading up to 160 characters. */
        title?: string;
        /** Pre-layout geometry and visual preset; IBM-inspired is an independent interpretation without IBM assets. */
        theme?: 'default' | 'ibm-inspired';
    },
): Promise<{ svg: string; width: number; height: number; boxes: Array<{ id: string; elementId: string; x: number; y: number; width: number; height: number }>; routes: Array<{ id: string; elementId: string; from: string; to: string; dashed: boolean; points: Array<{x:number;y:number}>; label: {x:number;y:number;lines:string[]} }>; lifelines: Array<{ id:string; elementId:string; x:number; y1:number; y2:number }> }> {
    const validText = (s: string, max: number, name: string) => { if (typeof s !== 'string' || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(s)) throw new Error(`${name} must be valid XML text up to ${max} characters`); };
        const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
        const key = (s: string) => Array.from(s,c=>c.codePointAt(0)!.toString(16)).join('-');
        const wrap = (s: string, n: number) => s.split(/\r?\n/).flatMap(line=>Array.from(line).length ? (Array.from(line).join('').match(new RegExp(`.{1,${n}}`,'gu')) ?? ['']) : ['']);
        const text = (lines: string[], x: number, y: number, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${opts.theme==='ibm-inspired'?14:13}" fill="${opts.theme==='ibm-inspired'?'#161616':'#27272a'}">${lines.map((l,i)=>`<tspan x="${x}" dy="${i?18:0}">${esc(l)}</tspan>`).join('')}</text>`;
        if (!Array.isArray(opts.participants) || opts.participants.length>30 || !Array.isArray(opts.messages) || opts.messages.length>200) throw new Error('Limit: 30 participants and 200 messages');
        if (opts.title !== undefined) validText(opts.title,160,'title');
        const ids = new Set<string>();
        for (const p of opts.participants) { if (!p || typeof p !== 'object') throw new Error('Invalid participant'); validText(p.id,128,'participant id'); validText(p.label,300,'participant label'); if (!p.id.trim() || ids.has(p.id)) throw new Error('Participant IDs must be unique and nonblank'); ids.add(p.id); }
        const messageIds = new Set<string>();
        for (const m of opts.messages) { if (!m || typeof m !== 'object') throw new Error('Invalid message'); validText(m.id,128,'message id'); validText(m.label,300,'message label'); if (!m.id.trim() || messageIds.has(m.id)) throw new Error('Message IDs must be unique and nonblank'); messageIds.add(m.id); if (!ids.has(m.from) || !ids.has(m.to)) throw new Error('Unknown participant reference'); if (m.dashed!==undefined && typeof m.dashed!=='boolean') throw new Error('dashed must be boolean'); }
        if(opts.theme!==undefined && !['default','ibm-inspired'].includes(opts.theme)) throw new Error('Unsupported sequence theme');
        const ibm=opts.theme==='ibm-inspired';
        const size=(n:number)=>ibm?Math.ceil(n/8)*8:n;
        const titleLines = opts.title ? wrap(opts.title,64) : [];
        const top = size(titleLines.length ? 52+titleLines.length*18 : (ibm?32:28));
        const headerHeight = size(Math.max(48,...opts.participants.map(p=>wrap(p.label,24).length*18+(ibm?32:24))));
        const boxes = opts.participants.map((p,i)=>({id:p.id,elementId:`sequence-participant-${key(p.id)}`,x:(ibm?32:28)+i*(ibm?288:280),y:top,width:ibm?224:216,height:headerHeight}));
        const byId = new Map(boxes.map(b=>[b.id,b]));
        let y=top+headerHeight+36;
        const routes = opts.messages.map(m=>{const a=byId.get(m.from)!,b=byId.get(m.to)!; const x1=a.x+a.width/2,x2=b.x+b.width/2; const lines=wrap(m.label,m.from===m.to?26:Math.max(24,Math.min(60,Math.floor(Math.abs(x2-x1)/8)-2))); y+=lines.length*18; const points=m.from===m.to?[{x:x1,y},{x:x1+232,y},{x:x1+232,y:y+28},{x:x1,y:y+28}]:[{x:x1,y},{x:x2,y}]; const result={id:m.id,elementId:`sequence-message-${key(m.id)}`,from:m.from,to:m.to,dashed:m.dashed??false,points,label:{x:m.from===m.to?x1+12:(x1+x2)/2,y:y-lines.length*18-3,lines}}; y+=m.from===m.to?72:44; return result;});
        const width=Math.max(280, titleLines.length?600:0, boxes.length?boxes[boxes.length-1]!.x+216+156:0);
        const height=Math.max(top+headerHeight+72,y+24);
        const lifelines=boxes.map(b=>({id:b.id,elementId:`sequence-lifeline-${key(b.id)}`,x:b.x+b.width/2,y1:b.y+b.height,y2:height-28}));
        const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="${ibm?'IBM Plex Sans,Arial,sans-serif':'Inter,Arial,sans-serif'}"><title>${esc(opts.title??'Sequence diagram')}</title><rect width="${width}" height="${height}" fill="#ffffff"/>`];
        if(titleLines.length) parts.push(`<path d="M28 24h32" stroke="${ibm?'#0f62fe':'#6384d5'}" stroke-width="3"/>`,text(titleLines,28,48,'start'));
        for(const l of lifelines) parts.push(`<path id="${l.elementId}" d="M${l.x} ${l.y1}V${l.y2}" stroke="#d4d4d8" stroke-dasharray="5 5" fill="none"/>`);
        for(const r of routes){const last=r.points[r.points.length-1]!,prev=r.points[r.points.length-2]!;const sign=last.x>=prev.x?1:-1;parts.push(`<g id="${r.elementId}" data-edge-id="${esc(r.id)}"><path d="${r.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${ibm?'#525252':'#85858d'}" stroke-width="${ibm?1:1.2}"${r.dashed?' stroke-dasharray="5 4"':''}/><path d="M${last.x-sign*7} ${last.y-4}L${last.x} ${last.y}L${last.x-sign*7} ${last.y+4}" fill="none" stroke="${ibm?'#0f62fe':'#6384d5'}" stroke-width="1.2"/>${text(r.label.lines,r.label.x,r.label.y+18,r.from===r.to?'start':'middle')}</g>`);}
        for(const b of boxes){const p=opts.participants.find(p=>p.id===b.id)!;const lines=wrap(p.label,24);parts.push(`<g id="${b.elementId}" data-node-id="${esc(b.id)}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${ibm?8:5}" fill="${ibm?'#edf5ff':'#f7f7f8'}" stroke="${ibm?'#0f62fe':'#d4d4d8'}"/>${text(lines,b.x+b.width/2,b.y+(b.height-lines.length*18)/2+14)}</g>`);}
        parts.push('</svg>');
        return {svg:parts.join(''),width,height,boxes,routes,lifelines};
}
