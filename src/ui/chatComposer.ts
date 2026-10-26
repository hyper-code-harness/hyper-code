/**
 * Render the shared Hyper chat composer for an agent or uncreated sidebar draft.
 *
 * Use for both existing chats and sidebar drafts; preserves attachments, keyboard controller and HTMX submission without creating an agent.
 * @param opts.action Same-origin submission path.
 * @param opts.controlsHtml Trusted existing agent stop/send controls; omitted uses a send button.
 * @param opts.statusHtml Trusted status-line popup markup; omitted for drafts.
 * @param opts.toolsHtml Trusted controls on the left of the toolbar under the text (model chip, plugin tools).
 * @param opts.metersHtml Trusted controls on the right of the toolbar, before send (context ring, plugin meters).
 * @param opts.aboveHtml Trusted chips shown above the text (prompt inject, plugin notes).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Same-origin submission path. */
        action: string;
        /** Trusted existing agent stop/send controls; omitted uses a send button. */
        controlsHtml?: string;
        /** Trusted status-line popup markup; omitted for drafts. */
        statusHtml?: string;
        /** Trusted controls on the left of the toolbar under the text (model chip, plugin tools). */
        toolsHtml?: string;
        /** Trusted controls on the right of the toolbar, before send (context ring, plugin meters). */
        metersHtml?: string;
        /** Trusted chips shown above the text (prompt inject, plugin notes). */
        aboveHtml?: string;
    },
): Promise<string> {
    // The chat's text field, attachments and toolbar are w.composer; chat.js finds them by id (#form, #input,
    // #files) and [data-attach-button]/[data-attachments], the draft and hotkeys scripts by data-form="chat".
    return ctx.fns.w.composer({
        post: opts.action,
        id: "form",
        attrs: { "data-form": "chat" },
        hidden: { requestId: "" },
        files: "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.yml,.yaml,.csv,.log",
        hint: "Enter to send · Shift+Enter new line · ⌘J/K scroll · Ctrl J next unread",
        above: opts.aboveHtml,
        tools: opts.toolsHtml,
        meters: `${opts.metersHtml ?? ""}${opts.statusHtml ?? ""}`,
        send: opts.controlsHtml,
    });
}
