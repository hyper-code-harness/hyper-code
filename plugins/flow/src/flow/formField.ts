/**
 * Render one accessible gap form field with its label and inline error
 *
 * Use inside gap cards for declaration-owned datetime-local and optional text fields with shared Hyper controls. Escapes labels and values, preserves submitted values and links field errors accessibly.
 * @param opts.field Trusted declaration field with label, type and constraints.
 * @param opts.domId Stable card DOM identifier used to scope input and error IDs.
 * @param opts.value Submitted value to preserve instead of the declaration default.
 * @param opts.error Validation error shown below this field.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Trusted declaration field with label, type and constraints. */
        field: types.flow.GapForm["fields"][number];
        /** Stable card DOM identifier used to scope input and error IDs. */
        domId: string;
        /** Submitted value to preserve instead of the declaration default. */
        value?: string;
        /** Validation error shown below this field. */
        error?: string;
    },
): Promise<string> {
    const e=(v:string)=>Bun.escapeHTML(v), f=opts.field, id=opts.domId+'-'+f.name;
    const timed=f.type==='datetime-local';
    let input=ctx.fns.procs.ui.field({name:'field.'+f.name,type:f.type,value:opts.value??f.value??'',ariaLabel:f.label,class:'w-full rounded-lg bg-base-100 text-sm',...(timed?{step:60,min:f.min?f.min+'T00:00':undefined}:{maxlength:f.maxLength,placeholder:'Необязательно'})});
    input=input.replace('<input ','<input id="'+e(id)+'" '+(timed?'required ':'')+(opts.error?'aria-invalid="true" aria-describedby="'+e(id)+'-error" ':''));
    return '<div class="space-y-2"><div class="flex items-center justify-between gap-2"><label class="text-xs font-medium text-base-content/70" for="'+e(id)+'">'+e(f.label)+'</label>'+(timed?'<span class="text-xs text-base-content/40">'+e(f.timezone)+'</span>':'')+'</div>'+input+(opts.error?'<p class="text-xs text-error" role="alert" id="'+e(id)+'-error">'+e(opts.error)+'</p>':'')+'</div>';
}
