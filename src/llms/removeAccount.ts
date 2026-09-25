// First half of deletion: confirmation only. Destructive work lives in
// confirmRemoveAccount so an accidental trash click can never remove a token.
/** Renders confirmation for removing one subscription account. */
/**
 * Confirm deletion of a named or managed subscription credential.
 * @param opts.provider Runtime credential provider.
 * @param opts.account Credential slot.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Runtime provider. */ provider: "anthropic-oauth" | "xai" | "claude-code" | "codex" | "kimi-coding";
    /** Credential slot. */ account: string;
}): string {
    const esc = (v: any) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const confirm = ctx.fns.llms.popupButton({ action: "confirm-remove-account", label: "Remove account", tone: "danger", class: "w-full" });
    return ctx.fns.ui.popupContent({
        title: "Remove account?",
        kind: "danger",
        html: `<div class="space-y-3"><p class="text-sm">Remove <code class="font-mono">${esc(opts.provider)}/${esc(opts.account)}</code>?</p><p class="text-xs leading-5 text-subtle">This deletes its encrypted managed token or isolated CLI credential directory. It is refused while an agent still uses the account.</p><form hx-popup="llms.confirmRemoveAccount" hx-popup-params="${esc(JSON.stringify(opts))}">${confirm}</form></div>`,
    });
}
