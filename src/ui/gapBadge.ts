/**
 * Render the cached Gaps count link in the shared left navigation rail
 *
 * Reads only the optional flow aggregate cache, never discovers gaps. Hides zero and uninitialized counts, and labels stale last-known counts without claiming all clear.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const cache=ctx.state.flow?.countCache;
    const loaded=Boolean((ctx.fns as any).flow?.refreshCount);
    const count=loaded?cache?.count:null;
    const stale=Boolean(cache?.stale || (cache?.checkedAt && Date.now()-cache.checkedAt>330000));
    const visible=typeof count==='number'&&count>0;
    const label=visible?count+' active gaps'+(stale?' — stale; last complete check '+new Date(cache!.checkedAt!).toISOString():''):'Gaps';
    return '<a id="gap-count-badge" href="/gaps"'+(visible?'':' hidden')+' aria-label="'+Bun.escapeHTML(label)+'" title="'+Bun.escapeHTML(label)+'" class="mt-1 size-7 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-content text-xs font-semibold tabular-nums hover:bg-warning/30" style="'+(visible?'display:flex':'display:none')+'">'+(visible?count:'')+'</a>';
}
