import { compile } from "reladraw";

/**
 * Checks reladraw diagram source and reports problems as data instead of throwing.
 *
 * Use while writing or repairing a reladraw diagram: it runs the full parse and
 * layout solve, so unanchored diagrams, circular or contradictory placements and
 * unknown attributes are all caught, each with the line to fix.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Reladraw source text to check. */
        source: string;
    },
): Promise<{ ok: boolean; problems: types.reladraw.Problem[] }> {
    const source = String(opts.source ?? "");
    if (!source.trim()) return { ok: false, problems: [{ line: 0, message: "source is empty" }] };
    try {
        compile(source);
        return { ok: true, problems: [] };
    } catch (error: any) {
        return { ok: false, problems: [{ line: typeof error?.line === "number" ? error.line : 0, message: String(error?.message ?? error) }] };
    }
}
