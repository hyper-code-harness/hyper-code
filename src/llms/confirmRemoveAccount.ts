/** Performs a confirmed subscription-account deletion. */
/**
 * Remove one account after the user confirmed the destructive action.
 * @param opts.provider Runtime credential provider.
 * @param opts.account Credential slot.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Runtime provider. */ provider: "anthropic-oauth" | "xai" | "claude-code" | "codex" | "kimi-coding";
    /** Credential slot. */ account: string;
}): Promise<string> {
    await ctx.fns.llm.removeAccount({ provider: opts.provider, account: opts.account });
    const esc = (v: any) => ctx.fns.w.escape({ text: String(v ?? "") });
    return ctx.fns.ui.popupContent({ title: "Account removed", kind: "success", html: `<div class="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success"><i class="ph ph-check-circle mr-1"></i>${esc(opts.provider)}/${esc(opts.account)} removed.</div>` });
}
