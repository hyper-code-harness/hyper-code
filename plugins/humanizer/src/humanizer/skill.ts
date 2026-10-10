// Return the vendored upstream work-humanizer skill text verbatim.
// ctx.fns.humanizer.skill({ part: "skill" }) → { part, markdown, chars, upstream }
import { resolve } from "node:path";

/**
 * Returns the vendored work-humanizer skill text verbatim, either SKILL.md or its tells.md tell lists.
 *
 * Use to read the actual humanizing rules yourself, to load them into another agent or
 * sub-agent as a system prompt, or to quote a specific rule to the user. The text is the
 * MIT-licensed skill written by Pawel Huryn (github.com/phuryn/work-humanizer), pinned to
 * the commit recorded in vendor/work-humanizer/PROVENANCE.json; nothing is rewritten or
 * summarized here. For the condensed tell lists only, pass part "tells".
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Which vendored file to return: the full skill instructions, or only the stock-vocabulary tell lists. @default skill */
    part?: "skill" | "tells";
}): Promise<{
    part: "skill" | "tells";
    markdown: string;
    chars: number;
    upstream: string;
    author: string;
    license: string;
}> {
    const part = opts?.part ?? "skill";
    const file = part === "tells" ? "tells.md" : "SKILL.md";
    const abs = resolve(import.meta.dir, "../../vendor/work-humanizer", file);
    const markdown = await Bun.file(abs).text();
    if (!markdown.trim()) throw new Error(`humanizer.skill: vendored ${file} is empty at ${abs}`);
    return {
        part,
        markdown,
        chars: markdown.length,
        upstream: "https://github.com/phuryn/work-humanizer",
        author: "Pawel Huryn",
        license: "MIT",
    };
}
