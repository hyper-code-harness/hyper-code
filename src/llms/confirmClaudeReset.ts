/**
 * Apply a user-confirmed Claude reset ticket and display the durable outcome
 *
 * Called by the reset confirmation popup over authenticated CSRF-protected RPC. Spends at most one reset for this ticket, never retries ambiguous writes, distinguishes provider success from cache refresh failure, and never echoes credentials or raw errors.
 * @param opts.ticketId One-use confirmation UUID issued by the reset popup.
 * @param opts.confirmed Must be exactly true after the user presses Use one reset.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** One-use confirmation UUID issued by the reset popup. */
        ticketId: string;
        /** Must be exactly true after the user presses Use one reset. */
        confirmed: boolean;
    },
): Promise<string> {
    try {
            const result = await ctx.fns.llm.consumeClaudeReset({ticketId:opts.ticketId,confirmed:opts.confirmed});
            const messages = {reset:'Claude limits were reset. One reset was used.',already_used:'Claude reports this reset was already used.',not_limited:'There is no eligible limit to reset.',cooldown:'Claude requires a cooldown before another reset.',ineligible:'This account is not eligible for that reset.',unavailable:'Claude reset is unavailable. Recheck availability before trying again.',changed:'The account or grant changed. Nothing was sent; reopen Reset limit to review fresh details.',busy:'Another reset for this Claude organization is in progress or awaiting verification. No second reset was sent.',uncertain:'Claude did not return a confirmed result. The reset may have been applied. Do not repeat it; check Claude usage. New reset attempts are blocked for ten minutes.'};
            const text = result.state==='sending' ? 'This reset is already being processed. A second request was not sent.' : messages[result.outcome ?? 'uncertain'];
            const refresh = result.state==='done' && result.usageRefreshed===false ? '<p class="text-xs text-subtle">Usage could not be refreshed. Refresh accounts later; this does not change the reset result.</p>' : '';
            const account = ctx.fns.w.escape({text:result.provider+'/'+result.account});
            return ctx.fns.ui.popupContent({title:result.outcome==='reset'?'Claude limits reset':'Claude reset result',kind:result.outcome==='reset'?'success':'warning',html:'<div class="space-y-3"><p class="text-xs text-subtle">'+account+'</p><p class="text-sm">'+text+'</p>'+refresh+'</div>'});
        } catch {
            return ctx.fns.ui.popupContent({title:'Claude reset not confirmed',kind:'warning',html:'<p class="text-sm">The confirmation expired, was invalid, or could not be completed. No automatic retry was made. If you already submitted it, check usage before opening another confirmation.</p>'});
        }
}
