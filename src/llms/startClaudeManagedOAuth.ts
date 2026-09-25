// Starts managed Claude OAuth from the popup and replaces it with the actual
// authorization step. The verifier stays in procedure state; only the safe URL
// and account name are rendered.
/** Starts managed Claude OAuth for one named account and renders authorization. */
/**
 * Begin a managed Anthropic OAuth flow for a named Claude subscription account.
 *
 * Uses PKCE and a localhost callback. The popup receives only the authorization
 * URL and account name; verifier and future tokens remain server-side.
 *
 * @param opts.account New managed Claude account slot.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Named managed account slot. */ account: string;
}): Promise<string> {
    const account = String(opts.account ?? "").trim();
    if (!/^[\w.-]{1,40}$/.test(account)) throw new Error("account must be a short name");
    const login = await ctx.fns.llm.startAnthropicOAuth({ account, label: account });
    const open = ctx.fns.procs.ui.button({ action: "open-anthropic-authorization", label: "Open Anthropic authorization", href: login.authorizationUrl, tone: "primary", class: "w-full", attrs: { onclick: "this.target='_blank';this.rel='noreferrer'" } });
    const complete = ctx.fns.llms.popupButton({ action: "complete-managed-oauth", label: "Complete manually", tone: "default", class: "w-full" });
    const html = `<div class="space-y-3">
      <div class="rounded-lg border border-ui-border bg-base-200 p-3 text-xs leading-5"><div class="font-semibold">Claude · ${escape(ctx, account)}</div><p class="mt-1">Open Anthropic authorization and finish signing in. The localhost callback will complete this popup flow automatically.</p></div>
      ${open}
      <form hx-popup="llms.completeClaudeManagedOAuth" class="space-y-2"><label class="block text-2xs font-medium">Fallback: paste final redirect URL or authorization code<input name="authorization" autocomplete="one-time-code" placeholder="Only if localhost callback did not complete" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"></label>${complete}</form>
      <p class="text-3xs leading-4 text-faint">Tokens are encrypted before storage and are never returned to the browser.</p>
    </div>`;
    return ctx.fns.ui.popupContent({ title: "Claude managed OAuth", kind: "oauth", html });
}
function escape(ctx: Context, value: any): string { return ctx.fns.procs.ui.escape({ text: String(value ?? "") }); }
