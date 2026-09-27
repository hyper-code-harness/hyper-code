// Edit a file in place from STRUCTURED edits — the only shape this tool takes.
//
// The §edit marker's anchored text DSL is translated into these same edits by
// agent.markerArgs before it ever gets here, so the text protocol stops at the
// protocol boundary and the engine below (ctx.fns.files.applyEdits) has one
// input shape regardless of who asked.
//
// Two families, deliberately not mixed in one call: literal replacement
// (oldText/newText — no anchors to fetch, must match exactly once) and anchored
// line ops (anchor/endAnchor/text — refused outright if the anchor moved).
/**
 * Implements structured file edits in the local workspace or on a remote SSH host.
 *
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host).
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 * @param opts.edits Structured edit operations: literal replace or anchored line ops.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host). */ host?: string; /** Workspace-relative path. */ path: string; /** Structured edit operations. */ edits: types.tools.EditOp[] },
): Promise<string> {
    const ops = opts.edits.map((e, i) => toOp(e, i));
    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.path });
    const host = at.host ?? undefined;
    const r = await ctx.fns.files.applyEdits({ path: host ? at.path : opts.path, host, ops });
    const n = opts.edits.length;
    return `edited ${host ? host + ":" : ""}${r.path} (${r.bytes} bytes, ${n} edit${n === 1 ? "" : "s"})`;
}

function toOp(edit: types.tools.EditOp, i: number): types.files.EditHashlineOp {
    const op = edit.op ?? (edit.oldText != null ? "replace" : undefined);
    const lines = () => String(edit.text ?? "").split("\n");

    if (op === "replace") {
        return { kind: "literal_replace", old: String(edit.oldText ?? ""), replacement: String(edit.newText ?? ""), all: edit.all === true };
    }
    if (op === "insertBefore" || op === "insertAfter") {
        if (!edit.anchor) throw new Error(`edits[${i}].anchor is required for ${op}`);
        return { kind: op === "insertBefore" ? "insert_before" : "insert_after", anchor: edit.anchor, lines: lines() };
    }
    if (op === "replaceLines") {
        if (!edit.anchor) throw new Error(`edits[${i}].anchor is required for replaceLines`);
        return { kind: "replace", start: edit.anchor, end: edit.endAnchor, lines: lines() };
    }
    if (op === "delete") {
        if (!edit.anchor) throw new Error(`edits[${i}].anchor is required for delete`);
        return { kind: "delete", start: edit.anchor, end: edit.endAnchor };
    }
    throw new Error(`edits[${i}] needs either oldText/newText or an op with an anchor`);
}
