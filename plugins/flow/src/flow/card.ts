/**
 * Render one stable gap card with its declaration-provided form
 *
 * Use on the Gaps board and for targeted HTMX replacements. Escapes text and values, keeps the page shell untouched, and renders supported fields through the shared formField component.
 * @param opts.flow Registered rule identity.
 * @param opts.gap Fresh declaration-owned gap including optional form.
 * @param opts.message Escaped action confirmation or general error.
 * @param opts.errors Escaped errors keyed by allowed field name.
 * @param opts.values Previously submitted editable local values.
 * @param opts.closed Show confirmation without another form when resolved.
 * @param opts.submissionId Retry identity for an unchanged form attempt.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Registered rule identity. */
        flow: string;
        /** Fresh declaration-owned gap including optional form. */
        gap: types.flow.Gap;
        /** Escaped action confirmation or general error. */
        message?: string;
        /** Escaped errors keyed by allowed field name. */
        errors?: Record<string,string>;
        /** Previously submitted editable local values. */
        values?: Record<string,string>;
        /** Show confirmation without another form when resolved. */
        closed?: boolean;
        /** Retry identity for an unchanged form attempt. */
        submissionId?: string;
    },
): Promise<string> {
    const e=(v:string)=>Bun.escapeHTML(v), g=opts.gap;
    const dom='gap-'+Bun.hash(opts.flow+':'+g.id).toString(16), form=g.form, d=g.display;
    let content='<div class="flex items-center justify-between gap-3"><span class="text-xs font-medium text-base-content/45">'+e(opts.flow)+'</span><span class="flex items-center gap-1.5 text-xs '+(opts.closed?'text-success':'text-base-content/60')+'"><span class="h-1.5 w-1.5 rounded-full '+(opts.closed?'bg-success':'bg-amber-400')+'"></span>'+e(opts.closed?'Записано':d?.status??'Требует внимания')+'</span></div>';
    content+='<header class="mt-4"><h2 class="text-lg font-semibold leading-snug tracking-tight">'+e(d?.title??g.summary)+'</h2>'+(d?.subtitle?'<p class="mt-1 text-sm text-base-content/60">'+e(d.subtitle)+'</p>':'')+'</header>';
    if(d?.detail)content+='<p class="mt-3 text-xs leading-relaxed text-base-content/55">'+e(d.detail)+'</p>';
    if(opts.message)content+='<p class="mt-4 rounded-lg '+(opts.closed?'bg-success/10 text-success':'bg-base-200 text-base-content/80')+' px-3 py-2.5 text-sm" role="status">'+e(opts.message)+'</p>';
    if(!opts.closed && form){
        content+='<form class="mt-5 space-y-4 border-t border-base-200 pt-4" method="post" action="/gaps/submit" hx-post="/gaps/submit" hx-target="#'+dom+'" hx-swap="outerHTML" hx-disabled-elt="find button">';
        for(const [name,value] of Object.entries({flow:opts.flow,id:g.id,revision:g.revision,action:form.id,submissionId:opts.submissionId??crypto.randomUUID()}))content+='<input type="hidden" name="'+name+'" value="'+e(value)+'">';
        for(const field of form.fields)content+=await ctx.fns.flow.formField({field,domId:dom,value:opts.values?.[field.name],error:opts.errors?.[field.name]});
        content+='<div class="flex items-end justify-between gap-4 pt-1"><p class="max-w-48 text-xs leading-relaxed text-base-content/45">Проверьте время перед записью.</p>'+ctx.fns.procs.ui.button({type:'submit',label:form.label,tone:'primary',size:'sm'})+'</div></form>';
    } else if(!opts.closed && g.will){
        content+='<form class="mt-5" method="post" action="/gaps/apply" hx-post="/gaps/apply" hx-target="#gaps-page" hx-select="#gaps-page" hx-swap="outerHTML" hx-disabled-elt="find button"><input type="hidden" name="flow" value="'+e(opts.flow)+'"><input type="hidden" name="id" value="'+e(g.id)+'"><input type="hidden" name="revision" value="'+e(g.revision)+'">'+ctx.fns.procs.ui.button({type:'submit',label:g.will,tone:'primary',size:'sm'})+'</form>';
    } else if(!opts.closed)content+='<p class="mt-4 text-xs text-base-content/45">Пока без действия</p>';
    return '<article id="'+dom+'" class="rounded-2xl border border-base-300/60 bg-base-100 p-5 shadow-md transition-shadow hover:shadow-lg" style="min-width:0;border-radius:16px;box-shadow:0 2px 4px rgb(0 0 0 / 4%),0 8px 24px rgb(0 0 0 / 7%)">'+content+'</article>';
}
