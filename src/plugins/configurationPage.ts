/**
 * Renders safe declared settings and an optional owned widget for a mounted plugin
 *
 * Use for the mounted plugin configuration page, never catalogue rendering. Secret settings show status and guidance only. Widget HTML is trusted installed code, invoked with an empty options object; action endpoints remain the plugin responsibility.
 * @param opts.name Exact mounted plugin name whose package declares procs.configuration.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact mounted plugin name whose package declares procs.configuration. */
        name: string;
    },
): Promise<string> {
    const config = await ctx.fns.plugins.configuration({name:opts.name});
    const esc=(value:string|number|boolean|null|undefined)=>Bun.escapeHTML(String(value??''));
    const action='/plugins/'+encodeURIComponent(config.name)+'/config';
    const formId='plugin-configuration';
    const fields=config.settings.map(item=>{
     const d=item.descriptor, name=esc(item.name), value=item.currentValue;
     let input='';
     if(item.secret) input='<p class="pl-note">'+(item.configured?'Configured':'Not configured')+'. Read-only here. Use encrypted Secrets / a chat secret input and the plugin’s documented environment variable or secret reference; never paste a secret into this form.</p>';
     else if(d.type==='boolean') input='<input form="'+formId+'" id="'+name+'" name="'+name+'" type="checkbox" value="true"'+(value===true?' checked':'')+'>';
     else if(d.type==='enum') input='<select form="'+formId+'" id="'+name+'" name="'+name+'" class="pl-select">'+(d.options??[]).map(option=>'<option value="'+esc(option)+'"'+(value===option?' selected':'')+'>'+esc(option)+'</option>').join('')+'</select>';
     else input='<input form="'+formId+'" id="'+name+'" name="'+name+'" class="pl-search" type="'+(d.type==='number'?'number':'text')+'"'+(d.type==='number'?' step="any"'+(d.min!==undefined?' min="'+esc(d.min)+'"':'')+(d.max!==undefined?' max="'+esc(d.max)+'"':''):'')+' value="'+esc(value)+'">';
     const reset=!item.secret&&item.source==='db'?'<form method="POST" action="'+action+'"><button class="pl-button" name="reset" value="'+name+'" type="submit">Reset override</button></form>':'';
     return '<article class="pl-card"><div class="pl-body"><h2><label for="'+name+'">'+esc(d.title??item.key)+'</label></h2><code>'+name+'</code><p>'+esc(d.description)+'</p>'+input+'<p class="pl-origin">Source: '+esc(item.source)+(d.env?' · Environment: '+esc(d.env):'')+'</p>'+reset+'</div></article>';
    }).join('');
    const secrets=(config.secrets??[]).map(item=>'<article class="pl-card"><div class="pl-body"><h2>'+esc(item.title??item.name)+'</h2><p>'+esc(item.description)+'</p><code>'+esc(item.ref)+'</code><p class="pl-origin">'+(item.configured?'Configured':'Not configured')+(item.required?' · Required':' · Optional')+'</p><p class="pl-note">To add or replace this secret, ask the agent to open a secure chat secret input for this reference. The value is stored encrypted, not in settings. No secret value is displayed or submitted by this page.</p></div></article>').join('');
    let widget='';
    if(config.widget){
     try{let fn: unknown=ctx.fns;for(const part of config.widget.split('.'))fn=(fn as Record<string,unknown>)[part];if(typeof fn!=='function')throw new Error('Widget unavailable');const html=await fn({});if(typeof html!=='string')throw new Error('Widget must return HTML');widget='<section class="pl-section" aria-label="Plugin widget">'+html+'</section>';}
     catch{widget='<p class="pl-note" role="status">Plugin widget unavailable. Settings remain editable.</p>';}
    }
    return '<link rel="stylesheet" href="/plugins/plugins.css"><section aria-label="Plugin settings"><h2>Settings</h2><p class="pl-note">Environment values take effect again after resetting an override. Widgets run trusted mounted plugin code; their actions are managed by the plugin.</p><div class="pl-list">'+fields+'</div>'+(config.settings.some(s=>!s.secret)?'<form id="'+formId+'" method="POST" action="'+action+'"><button class="pl-button" type="submit">Save settings</button></form>':'')+(secrets?'<section class="pl-section"><h2>Secrets</h2><div class="pl-list">'+secrets+'</div></section>':'')+widget+'</section>';
}
