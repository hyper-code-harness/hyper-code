/**
 * Render the shared Hyper chat composer for an agent or uncreated sidebar draft.
 *
 * Use for both existing chats and sidebar drafts; preserves attachments, keyboard controller and HTMX submission without creating an agent.
 * @param opts.action Same-origin submission path.
 * @param opts.controlsHtml Trusted existing agent stop/send controls; omitted uses a send button.
 * @param opts.statusHtml Trusted status-line popup markup; omitted for drafts.
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
    },
): Promise<string> {
    return `<form id="form"
          ${ctx.fns.procs.ui.attr({ form: "chat" })}
          class="chat-composer mx-auto w-[calc(100%-2rem)] max-w-3xl pb-2 pt-3"
          hx-post="${Bun.escapeHTML(opts.action)}"
          hx-trigger="submit"
          hx-encoding="multipart/form-data"
          hx-swap="none"
          hx-on::after:request="if (event.detail.ctx?.sourceElement === this && (event.detail.ctx?.response?.status < 400)) { this.elements.input.value=''; this.elements.files.value=''; this.querySelector('[data-attachments]')?.replaceChildren(); this.elements.input.focus(); }">
      <div class="mb-1.5 text-center text-3xs leading-none text-faint"><kbd>⌘J/K</kbd> scroll · <kbd>Ctrl J</kbd> next unread · <kbd>Ctrl K</kbd> back · Enter to send</div>
      <div data-attachments class="mb-2 hidden flex-wrap gap-2 rounded-xl border border-ui-border bg-base-100/70 p-2"></div>
      <div class="relative min-h-11 w-full">
        <input id="files" name="files" type="file" multiple class="hidden" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.yml,.yaml,.csv,.log">
        <button type="button" data-attach-button class="absolute left-1.5 top-1.5 z-20 flex size-8 items-center justify-center rounded-full text-faint hover:bg-base-100 hover:text-primary" title="Attach files" aria-label="Attach files"><i class="ph ph-paperclip"></i></button>
        ${opts.controlsHtml ?? '<button type="submit" class="absolute right-2 top-2" aria-label="Send message"><i class="ph ph-arrow-up"></i></button>'}
        <textarea id="input" name="text" rows="1" placeholder="Message agent…"
          class="glass-input block min-h-11 w-full resize-none overflow-y-auto rounded-[22px] border-0 py-[11px] pl-11 pr-12 font-sans text-sm leading-[22px] text-base-content placeholder:text-faint focus:outline-none"></textarea>
      </div>
      <div class="mt-1.5 flex min-w-0 justify-center px-4">${opts.statusHtml ?? ""}</div>
    </form>`;
}
