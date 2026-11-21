/**
 * Show a fresh Claude reset confirmation naming the exact account, scope and finite cost
 *
 * Open from the Claude account row. Only reads eligibility and prepares an expiring ticket; never spends a reset. The confirm form uses authenticated CSRF-protected RPC and an unnamed submit button, with no automatic submission.
 * @param opts.provider Local Claude credential adapter selected in the accounts row.
 * @param opts.account Exact configured credential slot to verify and display.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Local Claude credential adapter selected in the accounts row. */
        provider: "claude-code" | "anthropic-oauth";
        /** Exact configured credential slot to verify and display. */
        account: string;
    },
): Promise<string> {
    const esc = (text: string) => ctx.fns.w.escape({text});
        try {
            const ticket = await ctx.fns.llm.prepareClaudeReset({provider:opts.provider,account:opts.account});
            const params = esc(JSON.stringify({ticketId:ticket.id,confirmed:true}));
            const button = ctx.fns.w.button({label:'Use one reset',tone:'danger',size:'sm',submit:true,marks:{action:'confirm-claude-reset'}});
            const html = '<div class="space-y-3"><p class="text-sm">Account: <strong>'+esc(ticket.provider+'/'+ticket.account)+'</strong></p><p class="text-sm">'+esc(ticket.grantTitle)+'</p><p class="text-sm">Clears: '+esc(ticket.clears || 'provider-selected quota windows')+'</p><p class="text-sm">This spends <strong>one reset</strong> ('+ticket.remainingCount+' remaining in this grant).</p><p class="text-xs text-subtle">Grant expires '+esc(new Date(ticket.grantExpiresAt).toLocaleString())+'. Confirmation expires in five minutes. Close this window to cancel.</p><form hx-popup="llms.confirmClaudeReset" hx-popup-params="'+params+'">'+button+'</form></div>';
            return ctx.fns.ui.popupContent({title:'Use a Claude reset?',kind:'warning',html});
        } catch {
            return ctx.fns.ui.popupContent({title:'Claude reset unavailable',kind:'warning',html:'<p class="text-sm">No usable reset could be verified for this account. Refresh accounts or check Claude usage. No reset was sent.</p>'});
        }
}
