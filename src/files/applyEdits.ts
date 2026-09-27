// Apply a list of edit operations to a file — the engine both protocols reach.
//
// Anchored ops address lines by `<line><hash>` anchors, which are verified
// against the file as it stands: an anchor that moved is a stale anchor and the
// edit is refused, never guessed at. Literal ops replace exact text and must
// match exactly once (or at least once with `all`). The two kinds cannot be
// mixed in one call, because a literal replacement invalidates every anchor
// after it.
//
// ctx.fns.files.editHashline parses the text DSL and calls this; the `edit`
// tool builds the same op list straight from its structured arguments.
function splitLinesKeepEmpty(s: string): string[] {
    return s.replaceAll("\r\n", "\n").split("\n");
}

function validateAnchor(ctx: Context, base: string[], anchor: string): number {
    const { line, hash } = ctx.fns.files.parseAnchor({ anchor });
    const actual = base[line - 1];
    if (actual == null) throw new Error(`anchor out of range: ${anchor}`);
    const actualHash = ctx.fns.files.lineHash({ line, text: actual });
    if (actualHash !== hash) {
        throw new Error(`stale anchor ${anchor}: expected ${hash}, got ${actualHash} on line ${line}`);
    }
    return line;
}

type PlannedOp =
    | { kind: "insert_before" | "insert_after"; index: number; lines: string[]; order: number }
    | { kind: "delete" | "replace"; start: number; end: number; lines?: string[]; order: number };

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
    return a.start <= b.end && b.start <= a.end;
}

/**
 * Applies structured literal or hashline-anchored edits to a workspace file or a remote SSH file.
 *
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 * @param opts.ops Ordered edit operations to apply.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Workspace-relative path. */ path: string; /** Ordered edit operations to apply. */ ops: types.files.EditHashlineOp[] },
): Promise<{ path: string; bytes: number; diff: string; content: string }> {
    const { path, ops } = opts;
    const before = await ctx.fns.files.read({ path, host: opts.host });
    const hadTrailingNl = before.endsWith("\n");
    const literalOps = ops.filter((op): op is Extract<types.files.EditHashlineOp, { kind: "literal_replace" }> => op.kind === "literal_replace");
    const literalEdits: Array<{ start: number; end: number; replacement: string }> = [];
    for (const op of literalOps) {
        const matches: number[] = [];
        let from = 0;
        while (from <= before.length - op.old.length) {
            const at = before.indexOf(op.old, from);
            if (at < 0) break;
            matches.push(at);
            from = at + op.old.length;
        }
        if (op.all) {
            if (matches.length === 0) throw new Error("replace-all found 0 matches");
        } else if (matches.length !== 1) {
            throw new Error(`replace requires exactly one match, found ${matches.length}`);
        }
        for (const start of op.all ? matches : matches.slice(0, 1)) {
            literalEdits.push({ start, end: start + op.old.length, replacement: op.replacement });
        }
    }
    literalEdits.sort((a, b) => a.start - b.start);
    for (let i = 1; i < literalEdits.length; i++) {
        if (literalEdits[i]!.start < literalEdits[i - 1]!.end) {
            throw new Error("overlap conflict between literal replacements");
        }
    }
    let literalContent = before;
    for (const edit of [...literalEdits].reverse()) {
        literalContent = literalContent.slice(0, edit.start) + edit.replacement + literalContent.slice(edit.end);
    }
    if (literalOps.length) {
        if (ops.length !== literalOps.length) throw new Error("literal replace cannot be mixed with anchored ops");
        const diff = await ctx.fns.markdown.highlight({
            code: `--- ${path}\n+++ ${path}\n${before}\n---\n${literalContent}`,
            lang: "diff",
        }).catch(() => "");
        const res = await ctx.fns.files.write({ path, host: opts.host, content: literalContent, expectedContent: opts.host ? before : undefined });
        return { path: path, bytes: res.bytes, diff, content: literalContent };
    }
    // An empty file has no lines at all (not one empty line), so EOF/BOF inserts yield just the new text.
    const base = before === "" ? [] : splitLinesKeepEmpty(before);

    const planned: PlannedOp[] = ops.map((op, order) => {
        if (op.kind === "insert_after") {
            // The emit loop below attaches `after` groups to the 0-based line
            // index, so "after line N" (1-based) is index N-1. BOF means before
            // the first line; EOF means after the last one.
            if (op.anchor === "BOF") return { kind: "insert_before", index: 0, lines: op.lines, order };
            // A trailing newline leaves an empty last element in `base`; EOF
            // means after the last real line, i.e. before that empty tail.
            const lastReal = hadTrailingNl ? base.length - 2 : base.length - 1;
            const index = op.anchor === "EOF" ? Math.max(0, lastReal) : validateAnchor(ctx, base, op.anchor) - 1;
            return { kind: "insert_after", index, lines: op.lines, order };
        }
        if (op.kind === "insert_before") {
            // Before EOF is the same place as after the last real line.
            if (op.anchor === "EOF") {
                const lastReal = hadTrailingNl ? base.length - 2 : base.length - 1;
                return { kind: "insert_after", index: Math.max(0, lastReal), lines: op.lines, order };
            }
            const index = op.anchor === "BOF" ? 0 : validateAnchor(ctx, base, op.anchor) - 1;
            return { kind: "insert_before", index, lines: op.lines, order };
        }
        if (op.kind === "delete") {
            const start = validateAnchor(ctx, base, op.start) - 1;
            const end = (op.end ? validateAnchor(ctx, base, op.end) : start + 1) - 1;
            return { kind: "delete", start, end, order };
        }
        if (op.kind === "replace") {
            const start = validateAnchor(ctx, base, op.start) - 1;
            const end = (op.end ? validateAnchor(ctx, base, op.end) : start + 1) - 1;
            return { kind: "replace", start, end, lines: op.lines, order };
        }
        throw new Error(`unknown edit op: ${(op as any).kind}`);
    });

    const ranged = planned.filter((x): x is Extract<PlannedOp, { start: number; end: number }> => "start" in x);
    for (let i = 0; i < ranged.length; i++) {
        for (let j = i + 1; j < ranged.length; j++) {
            if (overlaps(ranged[i]!, ranged[j]!)) {
                throw new Error(`overlap conflict between ops at base ranges ${ranged[i]!.start + 1}-${ranged[i]!.end + 1} and ${ranged[j]!.start + 1}-${ranged[j]!.end + 1}`);
            }
        }
    }

    const insertsByIndex = new Map<number, { before: string[][]; after: string[][] }>();
    for (const op of planned) {
        if (!("index" in op)) continue;
        const bucket = insertsByIndex.get(op.index) ?? { before: [], after: [] };
        if (op.kind === "insert_before") bucket.before.push(op.lines);
        else bucket.after.push(op.lines);
        insertsByIndex.set(op.index, bucket);
    }

    const replaceByStart = new Map<number, Extract<PlannedOp, { kind: "replace" | "delete"; start: number; end: number; lines?: string[] }>>();
    for (const op of ranged) replaceByStart.set(op.start, op);

    const out: string[] = [];
    const pushGroups = (groups: string[][]) => {
        for (const g of groups) out.push(...g);
    };

    for (let i = 0; i <= base.length; i++) {
        const edge = insertsByIndex.get(i);
        if (edge) pushGroups(edge.before);

        if (i === base.length) {
            if (edge) pushGroups(edge.after);
            break;
        }

        const rangedOp = replaceByStart.get(i);
        if (rangedOp) {
            if (rangedOp.kind === "replace") out.push(...(rangedOp.lines ?? []));
            if (edge) pushGroups(edge.after);
            i = rangedOp.end;
            continue;
        }

        out.push(base[i]!);
        if (edge) pushGroups(edge.after);
    }

    let content = out.join("\n");
    if (hadTrailingNl && !content.endsWith("\n")) content += "\n";
    const diff = await ctx.fns.markdown.highlight({
        code: `--- ${path}\n+++ ${path}\n${before}\n---\n${content}`,
        lang: "diff",
    }).catch(() => "");
    const res = await ctx.fns.files.write({ path, host: opts.host, content, expectedContent: opts.host ? before : undefined });
    return { path: path, bytes: res.bytes, diff, content };
}