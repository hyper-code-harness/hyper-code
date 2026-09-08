/**
 * Renders the complete Gaps attention list with explicit revision-bound actions
 *
 * Use from the GET attention route or after an action. Escapes all declaration output, shows isolated check errors and an honest empty state; forms submit only flow and stable target identity.
 * @param opts.notice Optional action receipt status to display above the refreshed list.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional action receipt status to display above the refreshed list. */
        notice?: string;
    },
): Promise<string> {
    const rows=await ctx.fns.flow.list({});
    const esc=(value:string)=>Bun.escapeHTML(value);
    const count=rows.reduce((n,row)=>n+row.result.gaps.length,0);
    const cards=(await Promise.all(rows.flatMap(row=>row.result.gaps.map(gap=>ctx.fns.flow.card({flow:row.flow,gap}))))).join('');
    const issues=rows.filter(row=>row.result.error).map(row=>'<div role="alert" class="rounded-xl border border-error/20 bg-base-100 p-4 text-sm shadow-sm"><strong>'+esc(row.flow)+'</strong><p class="mt-1 text-error">'+esc(row.result.error??'')+'</p></div>').join('');
    return '<main id="gaps-page" class="flex-1 p-5 sm:p-8" style="min-height:calc(100dvh - 3rem);background-color:var(--color-base-200,#f3f4f6);background-image:radial-gradient(circle,color-mix(in srgb,currentColor 13%,transparent) 1px,transparent 1px);background-size:20px 20px"><header class="mb-8 flex items-start justify-between gap-4"><div><h1 class="text-2xl font-semibold tracking-tight">Gaps</h1><p class="mt-1 text-sm text-base-content/55">Требует внимания</p></div><a class="btn btn-ghost btn-sm gap-2" href="/gaps" hx-get="/gaps" hx-target="#gaps-page" hx-select="#gaps-page" hx-swap="outerHTML" aria-label="Обновить список gaps"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i>Обновить</a></header>'+(opts.notice?'<p role="status" class="mb-5 text-sm">'+esc(opts.notice)+'</p>':'')+(issues?'<div class="mb-6 grid gap-4">'+issues+'</div>':'')+'<div class="grid items-start gap-5" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));max-width:1480px">'+cards+'</div>'+(count===0?'<div class="py-20 text-center text-base-content/50"><i class="ph ph-check-circle text-4xl" aria-hidden="true"></i><h2 class="mt-3 text-base font-medium">'+(issues?'Доступные проверки выполнены':'Всё спокойно')+'</h2><p class="mt-1 text-sm">'+(issues?'Некоторые проверки недоступны — смотрите ошибки выше.':rows.length?'Сейчас нет открытых gaps.':'Правила ещё не подключены.')+'</p></div>':'')+'</main>';
}
