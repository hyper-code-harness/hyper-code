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
    return `<form id="form"
          ${ctx.fns.w.marks({ form: "chat" })}
          class="chat-composer mx-auto w-[calc(100%-2rem)] max-w-3xl pb-2 pt-3"
          hx-post="${Bun.escapeHTML(opts.action)}"
          hx-trigger="submit"
          hx-encoding="multipart/form-data"
          hx-swap="none"
          hx-on::after:request="if (event.detail.ctx?.sourceElement === this && (event.detail.ctx?.response?.status < 400)) { this.elements.input.value=''; this.elements.files.value=''; this.querySelector('[data-attachments]')?.replaceChildren(); this.elements.input.focus(); }">
      <input type="hidden" name="requestId" value="">
      <div data-attachments class="mb-2 hidden flex-wrap gap-2 rounded-xl border border-ui-border bg-base-100/70 p-2"></div>
      <div class="chat-box glass-input rounded-[22px] px-1.5 pb-1.5 pt-1">
        ${opts.aboveHtml ? `<div data-chat-above class="flex min-w-0 flex-wrap items-center gap-1 px-2 pt-1">${opts.aboveHtml}</div>` : ""}
        <input id="files" name="files" type="file" multiple class="hidden" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.yml,.yaml,.csv,.log">
        <textarea id="input" name="text" rows="1" placeholder="Ask the agent…" title="Enter to send · Shift+Enter new line · ⌘J/K scroll · Ctrl J next unread"
          class="block max-h-[40vh] min-h-10 w-full resize-none overflow-y-auto bg-transparent [field-sizing:content] border-0 px-2.5 py-2 font-sans text-sm leading-[22px] text-base-content placeholder:text-faint focus:outline-none"></textarea>
        <div class="flex min-w-0 items-center gap-1">
          <button type="button" data-attach-button class="flex size-8 shrink-0 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-primary" title="Attach files" aria-label="Attach files"><i class="ph ph-plus"></i></button>
          <div data-chat-tools class="flex min-w-0 items-center gap-0.5">${opts.toolsHtml ?? ""}</div>
          <div data-chat-meters class="ml-auto flex shrink-0 items-center gap-0.5">${opts.metersHtml ?? ""}${opts.statusHtml ?? ""}</div>
          <div class="flex shrink-0 items-center">${opts.controlsHtml ?? '<button type="submit" class="flex size-8 items-center justify-center rounded-full bg-base-content text-base-100" aria-label="Send message"><i class="ph ph-arrow-up text-base"></i></button>'}</div>
        </div>
      </div>
    </form>`;
}
