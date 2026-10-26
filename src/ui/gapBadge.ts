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
    // The live script swaps the whole element by id, so the id sits on a wrapper; hidden when there is nothing to count.
    if(!visible) return '<div id="gap-count-badge" hidden class="dock-badge" data-count="0"></div>';
    const item=ctx.fns.w.railItem({label,icon:'list-checks',badge:count!,action:{href:'/gaps'}});
    return '<div id="gap-count-badge" class="dock-badge" data-tone="warning" data-count="'+count+'">'+item+'</div>';
}
