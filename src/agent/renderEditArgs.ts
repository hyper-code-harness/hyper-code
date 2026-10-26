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
    const w = ctx.fns.w;
    const path = String(opts.path ?? "");
    const lang = ctx.fns.agent.toolLang({ name: "read", args: { path }, part: "result" });
    const edits = Array.isArray(opts.edits) ? opts.edits : [];
    const code = (text: unknown, diff: "remove" | "add") => w.code({ code: String(text ?? ""), lang, diff, title: diff === "remove" ? "− removed" : "+ added" });
    const note = (text: string, tone?: types.w.Tone) => w.eventNote({ text, tone, icon: tone === "danger" ? "trash" : undefined });

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
        if (op === "delete" && edit.anchor) blocks.push(note(`Delete selected line${edit.endAnchor ? " range" : ""}`, "danger"));
        cards.push(w.card({
            title: `${index + 1}. ${label}`,
            actions: w.badge({ text: location }),
            body: w.box({ body: blocks.join("") || note("No inline content"), mix: { layout: "stack", gap: "s2" } }),
        }));
    }

    const head = w.box({
        body: w.icon({ name: "file-code", size: 14 }) + w.box({ body: w.escape({ text: path }), mix: { mono: true, truncate: true, grow: true }, tag: "span" })
            + w.box({ body: `${edits.length} change${edits.length === 1 ? "" : "s"}`, mix: { text: "small", ink: "faint" }, tag: "span" }),
        mix: { layout: "row", gap: "s2", ink: "muted" },
    });
    return w.box({ body: head + (cards.join("") || w.empty({ title: "No edits" })), mix: { layout: "stack", gap: "s3" } });
}
