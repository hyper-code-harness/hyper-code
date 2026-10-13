/**
 * Renders the provider-neutral plugin catalogue and offline installed-source inventory.
 *
 * Use for browser plugin discovery with a twenty-result cap, provider filtering, partial errors and safe preview-only actions. Separately identifies managed disk sources and runtime mounts; needs no particular provider plugin.
 * @param opts.q Search text or offline source-name filter, truncated to 500 characters.
 * @param opts.provider Optional validated provider identifier to filter sources.
 * @param opts.tab Catalogue search or offline local inventory. @default catalog
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Search text or offline source-name filter, truncated to 500 characters. */
        q?: string;
        /** Optional validated provider identifier to filter sources. */
        provider?: string;
        /** Catalogue search or offline local inventory. @default catalog */
        tab?: "catalog" | "installed";
    },
): Promise<string> {
    const esc=(v:unknown)=>Bun.escapeHTML(String(v??''));
    const q=(opts.q??'').slice(0,500), offline=opts.tab==='installed';
    let providers:types.plugins.ProviderInfo[]=[],providerWarning='';
    try{providers=await ctx.fns.plugins.providers({});}catch{providerWarning='Provider discovery unavailable; local inventory remains available.';}
    const mounted=await ctx.fns.plugins.list({});
    const configurable=new Set<string>();
    if(offline) await Promise.all(mounted.map(async p=>{try {const metadata=await ctx.fns.plugins.readMetadata({path:p.path+'/package.json'}); const procs=metadata.procs; if(procs&&typeof procs==='object'&&!Array.isArray(procs)){const config=procs.configuration;if(config&&typeof config==='object'&&!Array.isArray(config)&&(Array.isArray(config.settings)&&config.settings.length||Array.isArray(config.secrets)&&config.secrets.length||typeof config.widget==='string'))configurable.add(p.name);}}catch{ /* Unreadable metadata must not advertise configuration. */ }}));
    const configure=(name:string)=>mounted.some(p=>p.name===name)&&configurable.has(name)?'<a class="pl-button" href="/plugins/'+encodeURIComponent(name)+'?tab=settings">Configure</a>':'';
    const functionsLink=(name:string)=>{const plugin=mounted.find(p=>p.name===name);return plugin?'<a class="pl-button" href="/plugins/'+encodeURIComponent(name)+'?tab=functions">Functions · '+esc(plugin.functions??0)+'</a>':'';};
    const icon=(value:string)=>/^ph-[a-z0-9-]+$/.test(value)?'<i class="ph '+esc(value)+'" aria-hidden="true"></i>':/^https?:\/\//.test(value)?'<img src="'+esc(value)+'" alt="" width="28" height="28" loading="lazy">':esc(value);
    let inventory:Awaited<ReturnType<typeof ctx.fns.plugins.installed>>['plugins']=[],warning=providerWarning;
    try {const r=await ctx.fns.plugins.installed({});inventory=r.plugins;if(r.errors.length)warning='Some local sources could not be verified.';}catch{warning='Local inventory unavailable; actions disabled.';}
    const sameSource=(a:types.plugins.ProviderSelection,b:types.plugins.ProviderSelection)=>a.provider===b.provider&&a.name===b.name&&JSON.stringify(Object.entries(a.source).sort())===JSON.stringify(Object.entries(b.source).sort());
    const review=(selection:types.plugins.ProviderSelection,operation:'install'|'update'|'rollback',label:string)=>(operation==='rollback'||providers.some(p=>p.id===selection.provider&&p.handlers.materialize))?'<form method="POST" action="/plugins/review"><input type="hidden" name="selection" value="'+esc(JSON.stringify(selection))+'"><input type="hidden" name="operation" value="'+operation+'"><button class="pl-button" type="submit">'+esc(label)+'</button></form>':'';
    const renderCard=(item:{name:string;label?:string;description?:string;icon?:string;version?:string;publisher?:string},badges:string[],source:string,actions='',revision?:string)=>'<article class="pl-card"><div class="pl-icon" aria-hidden="true">'+icon(item.icon??item.name.split('-').map(v=>v[0]).join('').slice(0,2).toUpperCase())+'</div><div class="pl-body"><div class="pl-title"><h2>'+(mounted.some(p=>p.name===item.name)?'<a href="/plugins/'+encodeURIComponent(item.name)+'">'+esc(item.label??item.name)+'</a>':esc(item.label??item.name))+'</h2>'+(item.version?'<span class="pl-badge">'+esc(item.version)+'</span>':'')+badges.map(b=>'<span class="pl-badge">'+esc(b)+'</span>').join('')+'</div><p class="pl-description">'+esc(item.description??'No description available.')+'</p><div class="pl-meta"><span>'+esc(source)+'</span>'+(item.publisher?'<span>'+esc(item.publisher)+'</span>':'')+(revision&&!revision.startsWith('mounted:')?'<code title="'+esc(revision)+'">'+esc(revision.slice(0,16))+'</code>':'')+'</div></div><div class="pl-actions">'+functionsLink(item.name)+actions+'</div></article>';
    const card=(item:types.plugins.ProviderItem,local?:typeof inventory[number])=>{
     const s=item.selection, provider=providers.find(p=>p.id===s.provider), conflict=inventory.some(p=>p.name===s.name)&&!local;
     const active=mounted.some(p=>p.name===s.name);
     const state=local?((local.status==='legacy'||local.status==='invalid')?'Needs verification':!local.managed?'Unmanaged source':local.modified?'Locally modified':'Installed source'):active?'Mounted':conflict?'Different local source':'Not installed';
     let actions='';
     if(!warning&&!conflict&&!s.revision.startsWith('mounted:')){if(!local&&!active)actions=review(s,'install','Review install');else if(local&&local.managed&&local.modified===false&&local.selection&&sameSource(local.selection,s)){if(local.selection.revision!==s.revision)actions=review(s,'update','Review update');if(offline&&local.previousSelection)actions+=review(local.previousSelection,'rollback','Review rollback');}}
     return renderCard({...mounted.find(p=>p.name===s.name),...local,...item,name:s.name},state==='Mounted'?[state]:[state,active?'Mounted':'Not mounted'],provider?.label??s.provider,actions+(offline&&local?configure(s.name):''),s.revision);
    };
    let content='';
    if(offline){
     const rows=inventory.filter(p=>(!opts.provider||p.selection?.provider===opts.provider)&&(!q||p.name.toLowerCase().includes(q.toLowerCase())));
     content='<div class="pl-section-head"><h2>Installed sources</h2><span class="pl-origin">Local inventory · no provider requests</span></div><div class="pl-list">'+rows.map(p=>p.selection?card({...p,selection:p.selection},p):renderCard({...mounted.find(m=>m.name===p.name),...p},[p.status==='invalid'?'Needs verification':'Unmanaged source',mounted.some(m=>m.name===p.name)?'Mounted':'Not mounted'],'Local',configure(p.name))).join('')+'</div>'+(rows.length?'':'<p class="pl-empty">No installed sources match this filter.</p>');
     const sourceNames=new Set(inventory.map(p=>p.name));const mountOnly=mounted.filter(p=>!sourceNames.has(p.name)&&(!q||p.name.toLowerCase().includes(q.toLowerCase())));
     content+='<section class="pl-section"><h2>Other mounted plugins</h2><p class="pl-origin">Runtime mounts are separate from managed local source inventory.</p><div class="pl-list">'+mountOnly.map(p=>renderCard(p,['Mounted'],p.source??'runtime',configure(p.name))).join('')+'</div></section>';
    }else{
     const selected=providers.filter(p=>!opts.provider||p.id===opts.provider);let next=0;
     const results:Array<{items:types.plugins.ProviderItem[];errors:string[]}>=new Array(selected.length);
     await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{while(next<selected.length){const i=next++;try{results[i]=await ctx.fns.plugins.dispatch({provider:selected[i]!.id,operation:'search',args:{q,limit:20}}) as {items:types.plugins.ProviderItem[];errors:string[]};}catch{results[i]={items:[],errors:['Provider unavailable. Other sources remain available.']};}}}));
     const counts=results.map(()=>0);let remaining=20;
     while(remaining>0){let added=false;for(let i=0;i<results.length&&remaining>0;i++){if(counts[i]!<results[i]!.items.length){counts[i]=counts[i]!+1;remaining--;added=true;}}if(!added)break;}
     content='<div class="pl-section-head"><h2>'+(q?'Search results':'Available extensions')+'</h2><span class="pl-origin">Up to 20 results across providers</span></div>'+results.map((r,i)=>{const rows=r.items.slice(0,counts[i]);return '<section class="pl-section"><div class="pl-section-head"><h3>'+esc(selected[i]!.label)+'</h3></div>'+(r.errors.length?'<details class="pl-origin"><summary>'+r.errors.length+' source '+(r.errors.length===1?'notice':'notices')+'</summary><ul>'+r.errors.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul></details>':'')+'<div class="pl-list">'+rows.map(p=>card(p,inventory.find(l=>l.selection&&sameSource(l.selection,p.selection)))).join('')+'</div>'+(!r.items.length?'<p class="pl-empty">No plugins found in this source.</p>':!rows.length?'<p class="pl-empty">Narrow your search to see more from this source.</p>':'')+'</section>';}).join('')+(!selected.length?'<p class="pl-empty">No matching providers. <a href="/plugins/config">View sources</a>.</p>':'');
    }
    return '<link rel="stylesheet" href="/plugins/plugins.css"><div class="pl"><header class="pl-head"><div class="pl-mark" aria-hidden="true">⊞</div><div><h1>Plugins</h1><p class="pl-sub">Extensions for your workspace</p></div><a class="pl-gear" href="/plugins/config" aria-label="Plugin sources">⚙</a></header><form method="GET" action="/plugins" class="pl-search"><input type="hidden" name="tab" value="'+(offline?'installed':'catalog')+'"><input name="q" aria-label="Search plugins" value="'+esc(q)+'" placeholder="Search extensions…"><select name="provider" aria-label="Provider"><option value="">All providers</option>'+providers.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===opts.provider?' selected':'')+'>'+esc(p.label)+'</option>').join('')+'</select><button class="pl-button pl-secondary" type="submit">Search</button></form><nav class="pl-tabs" aria-label="Extensions"><a href="/plugins"'+(!offline?' aria-current="page"':'')+'>Catalog</a><a href="/plugins?tab=installed"'+(offline?' aria-current="page"':'')+'>Installed <span class="pl-count">'+inventory.length+'</span></a></nav>'+(warning?'<p class="pl-alert" role="status">'+esc(warning)+'</p>':'')+'<section aria-live="polite">'+content+'</section><p class="pl-note">◇ Review before you install. Changes require preview and separate human confirmation. Installed source does not imply mounted runtime.</p></div>';
}
