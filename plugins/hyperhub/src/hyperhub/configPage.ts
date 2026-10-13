/**
 * Renders the offline HyperHub saved hub configuration form
 *
 * Use for the configuration subpage. Provides label, HTTPS origin, repository scope and enabled fields with explicit POST save and remove controls. Never contacts a registry.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const hubs=await ctx.fns.hyperhub.configuredHubs({}); const esc=(v:string)=>Bun.escapeHTML(v);
    const rows=[...hubs,...(hubs.length<8?[{label:'',origin:'',enabled:true,repo:''}]:[])];
    return '<link rel="stylesheet" href="/hyperhub/hyperhub.css"><div class="hh hh-config"><a class="hh-back" href="/plugins">← Back to plugins</a><header class="hh-head"><div class="hh-mark" aria-hidden="true">⚙</div><div><h1>Hub configuration</h1><p class="hh-sub">Choose where your extensions come from</p></div></header><p class="hh-note">Connect up to eight credential-free HTTPS origins. Changes stay local: saving never installs or publishes plugins.</p><form method="POST" action="/hyperhub/config">'+rows.map((h,i)=>'<fieldset class="hh-hub"><legend>'+ (i<hubs.length?esc(h.label||'Saved hub'):'＋ Add hub')+'</legend><div class="hh-fields"><label class="hh-field">Label<input name="label'+i+'" maxlength="80" value="'+esc(h.label)+'" placeholder="My team hub"><small>A friendly name shown in the catalog.</small></label><label class="hh-field">HTTPS origin<input type="url" name="origin'+i+'" value="'+esc(h.origin)+'" placeholder="https://registry.example"><small>Origin only, without credentials or a path.</small></label><label class="hh-field hh-scope">Repository scope (optional)<input name="repo'+i+'" maxlength="240" value="'+esc(h.repo||'')+'" placeholder="team/repository"><small>Leave blank to search the whole hub.</small></label></div><div class="hh-toggles"><label><input type="checkbox" name="enabled'+i+'" '+(h.enabled?'checked':'')+'> Enabled in catalog</label>'+(i<hubs.length?'<label><input type="checkbox" name="remove'+i+'"> Remove on save</label>':'<span>Blank new rows are ignored</span>')+'</div></fieldset>').join('')+'<div class="hh-footer"><button class="hh-button" type="submit">Save hubs</button><span>Only applied when you save.</span></div></form></div>';
}
