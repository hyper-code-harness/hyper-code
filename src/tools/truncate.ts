// Bound a tool's text output by lines and bytes, the way the tool itself wants it.
//
// The idea is pi-durable's (MIT, @earendil-works/pi-durable truncate.js): the TOOL
// truncates, because only the tool knows what a continuation looks like — `read`
// keeps the head and says which line to continue from, `bash` keeps the tail and
// points at a file with the rest. The generic stash in agent.run is then only a
// safety net for tools that do not care.
/**
 * Keeps the head or the tail of a text within a line and byte budget, cutting only at line boundaries.
 *
 * Use from a tool that wants to bound its own output and tell the model how to get the rest; the returned line numbers are 1-based and refer to the original text.
 * @param opts.text Complete text to bound.
 * @param opts.keep Which end to keep: head for files, tail for command output. @default "head"
 * @param opts.maxLines Maximum number of lines kept. @default 2000
 * @param opts.maxBytes Maximum UTF-8 bytes kept. @default 51200
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Complete text to bound. */
        text: string;
        /** Which end to keep: head for files, tail for command output. @default "head" */
        keep?: "head" | "tail";
        /** Maximum number of lines kept. @default 2000 */
        maxLines?: number;
        /** Maximum UTF-8 bytes kept. @default 51200 */
        maxBytes?: number;
    },
): { text: string; truncated: boolean; totalLines: number; firstLine: number; lastLine: number } {
    const maxLines = Math.max(1, opts.maxLines ?? 2000);
    const maxBytes = Math.max(1, opts.maxBytes ?? 50 * 1024);
    const text = String(opts.text ?? "");
    const lines = text.split("\n");
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    const totalLines = lines.length;
    if (totalLines <= maxLines && Buffer.byteLength(text) <= maxBytes) {
        return { text, truncated: false, totalLines, firstLine: 1, lastLine: totalLines };
    }

    const tail = opts.keep === "tail";
    const kept: string[] = [];
    let bytes = 0;
    for (let i = 0; i < totalLines && kept.length < maxLines; i++) {
        const line = lines[tail ? totalLines - 1 - i : i]!;
        const size = Buffer.byteLength(line) + 1;
        if (bytes + size > maxBytes) {
            // One line alone over the budget: keep a cut piece of it rather than nothing.
            if (kept.length === 0) kept.push(cutToBytes(line, maxBytes, tail));
            break;
        }
        kept.push(line);
        bytes += size;
    }
    if (tail) kept.reverse();
    const firstLine = tail ? totalLines - kept.length + 1 : 1;
    const lastLine = tail ? totalLines : kept.length;
    return { text: kept.join("\n"), truncated: true, totalLines, firstLine, lastLine };
}

function cutToBytes(line: string, maxBytes: number, fromEnd: boolean): string {
    const buf = Buffer.from(line);
    const piece = fromEnd ? buf.subarray(buf.length - maxBytes) : buf.subarray(0, maxBytes);
    return piece.toString("utf8").replace(/^\uFFFD|\uFFFD$/g, "");
}
