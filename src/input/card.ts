// The chat card of one input. The same markup serves the transcript render, the
// POST answer and the live refresh, so a form and its answer can never drift:
// whatever state the row is in decides what the card shows.
/**
 * Renders the chat card of an input: the live form while open, the answer once submitted or cancelled.
 * @param opts.id Input identifier.
 * @param opts.error Validation message shown under an open form.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Input identifier. */
    id: string;
    /** Validation message shown under an open form. */
    error?: string | null;
}): Promise<string> {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
    const domId = `input-${String(opts.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    const input = await ctx.fns.input.get({ id: opts.id });
    if (!input) return `<div id="${domId}" class="w-full rounded-lg border border-ui-border px-3 py-2 text-2xs text-muted">input ${esc(opts.id)} is gone</div>`;
    const kind = (ctx.state as any).input?.kinds?.[input.kind] as types.input.Registered | undefined;

    const badges: Record<string, [string, "neutral" | "info" | "success" | "warning" | "error"]> = {
        open: ["awaiting response", "info"], processing: ["saving…", "warning"],
        submitted: ["answered", "success"], cancelled: ["cancelled", "neutral"],
    };
    const [label, tone] = badges[input.state] ?? [input.state, "neutral"];
    const badge = ctx.fns.ui.statusBadge({ label, tone });
    const icon = kind?.icon ?? "textbox";
    const message = input.message ? `<div class="prose prose-sm max-w-none text-base-content prose-p:my-1">${await ctx.fns.markdown.render({ source: input.message })}</div>` : "";

    let body: string;
    if (!kind) body = `<p class="text-2xs text-error">unknown input kind "${esc(input.kind)}" — its plugin is not loaded</p>`;
    else if (input.state === "open") {
        const fields = await kind.open(ctx, { input, error: opts.error ?? null });
        const buttons = kind.buttons ? await kind.buttons(ctx, { input })
            : ctx.fns.procs.ui.button({ action: "input-submit", label: "Submit", type: "submit", tone: "primary", size: "sm" });
        // formnovalidate: a required field left empty must not block "cancel".
        const cancel = kind.cancel === false ? "" : ctx.fns.procs.ui.button({
            action: "input-cancel", label: "Cancel", type: "submit", tone: "ghost", size: "sm", name: "_action", value: "cancel",
        }).replace("<button", "<button formnovalidate");
        const error = opts.error ? `<p class="text-2xs text-error" role="alert">${esc(opts.error)}</p>` : "";
        // The CSRF token rides in a header read from the page meta at submit time:
        // the card is rendered without a request (when the agent opens it), so
        // there is no token to bake into a hidden field.
        body = `<form hx-post="/input/${esc(input.id)}" hx-target="#${domId}" hx-swap="outerHTML" `
            + `hx-headers='js:{"x-csrf-token": document.querySelector("meta[name=csrf-token]")?.content || ""}' class="mt-2 space-y-2" autocomplete="off">`
            + fields + error
            + (buttons || cancel ? `<div class="flex flex-wrap items-center justify-end gap-2 pt-1">${cancel}${buttons}</div>` : "")
            + `</form>`;
    } else if (input.state === "submitted") body = `<div class="mt-2">${await kind.done(ctx, { input })}</div>`;
    else if (input.state === "processing") body = `<p class="mt-2 text-2xs text-muted">processing response…</p>`;
    else body = `<p class="mt-2 text-2xs text-muted">${esc(input.error || "Cancelled — no response will be provided.")}</p>`;

    const tones = { open: "border-info/40 bg-base-100", processing: "border-warning/40 bg-base-100", submitted: "border-ui-border bg-base-200/45", cancelled: "border-ui-border bg-base-200/30 opacity-80" } as Record<string, string>;
    const inner = `<div class="flex items-start gap-2"><span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-base-200"><i class="ph ph-${esc(icon)} text-info" aria-hidden="true"></i></span>`
        + `<div class="min-w-0 flex-1"><div class="flex min-h-6 items-center gap-2"><span class="min-w-0 flex-1 text-sm font-semibold">${esc(input.title)}</span>${badge}</div>${message}${body}</div></div>`;
    const attrs = `class="w-full rounded-lg border ${tones[input.state] ?? tones.open} px-3 py-2" data-input-kind="${esc(input.kind)}" data-input-state="${esc(input.state)}"`;
    // Deliberately NOT a live region: the events client re-fetches every live
    // region when a tab becomes visible again, which would wipe a half-typed
    // password the moment someone switches away to copy it. The submit answer
    // swaps this card in place; other tabs see the result on their next load.
    return `<div id="${domId}" ${attrs}>${inner}</div>`;
}
