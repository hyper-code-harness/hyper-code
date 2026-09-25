// Human-readable edit preview for the tool dialog. The JSON envelope is useful
// to a provider, not to a person: show each operation as a small diff card.
/** Render edit args for the runtime.  * @param opts.path File path to read or render.
 * @param opts.edits File edit operations to render.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Path to the target resource. */
    path?: string;
        /** Edits used by the operation. */
    edits?: types.tools.EditOp[] },
): Promise<string> {
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: String(value ?? "") });
    const path = String(opts.path ?? "");
    const lang = ctx.fns.agent.toolLang({ name: "read", args: { path }, part: "result" });
    const edits = Array.isArray(opts.edits) ? opts.edits : [];

    const code = async (text: any, tone: "remove" | "add") => {
        const html = await ctx.fns.markdown.highlight({ code: String(text ?? ""), lang });
        const cls = tone === "remove"
            ? "border-error/30 bg-error/10 edit-remove"
            : "border-success/30 bg-success/10 edit-add";
        const sign = tone === "remove" ? "−" : "+";
        return `<div class="relative overflow-hidden rounded-lg border ${cls}"><span class="absolute left-2 top-1.5 z-10 font-mono text-xs font-bold ${tone === "remove" ? "text-error" : "text-success"}">${sign}</span><div class="pl-5">${html}</div></div>`;
    };

    const cards: string[] = [];
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index]!;
        const op = edit.op ?? (edit.oldText != null ? "replace" : "edit");
        const location = edit.anchor
            ? `@${edit.anchor}${edit.endAnchor ? ` … @${edit.endAnchor}` : ""}`
            : edit.all ? "all matches" : "one match";
        const label = op === "replace" ? "Replace"
            : op === "replaceLines" ? "Replace lines"
            : op === "insertBefore" ? "Insert before"
            : op === "insertAfter" ? "Insert after"
            : op === "delete" ? "Delete"
            : op;
        const blocks: string[] = [];
        if (edit.oldText != null) blocks.push(await code(edit.oldText, "remove"));
        if (edit.newText != null && edit.newText !== "") blocks.push(await code(edit.newText, "add"));
        if ((op === "replaceLines" || op === "insertBefore" || op === "insertAfter") && edit.text != null) blocks.push(await code(edit.text, "add"));
        if (op === "delete" && edit.anchor) blocks.push(`<div class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">Delete selected line${edit.endAnchor ? " range" : ""}</div>`);
        cards.push(`<section class="rounded-xl border border-ui-border bg-base-100 p-3 shadow-sm"><div class="mb-2 flex items-center gap-2"><span class="flex size-5 items-center justify-center rounded-full bg-base-200 text-3xs font-semibold text-subtle">${index + 1}</span><span class="text-xs font-semibold text-muted">${esc(label)}</span><span class="ml-auto rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-3xs text-subtle">${esc(location)}</span></div><div class="space-y-2">${blocks.join("") || `<div class="text-xs text-faint">No inline content</div>`}</div></section>`);
    }

    return `<div class="edit-preview"><div class="mb-3 flex items-center gap-2"><i class="ph ph-file-code text-faint"></i><span class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-muted">${esc(path)}</span><span class="text-3xs text-faint">${edits.length} change${edits.length === 1 ? "" : "s"}</span></div><div class="space-y-3">${cards.join("") || `<div class="rounded-lg border border-ui-border bg-base-100 p-3 text-xs text-faint">No edits</div>`}</div></div>`;
}
