// Assemble the tool part of the system prompt FROM THE REGISTRY, so the prompt
// is a function of what is actually loaded rather than a constant that drifts.
//
// Three contributions per tool, all optional:
//   promptSnippet     → one line in the "Available tools" index
//   doc               → the tool's own wire-format block (markers mode only:
//                       in JSON mode the schema travels natively and repeating
//                       it in prose is the format tax we are trying not to pay)
//   promptGuidelines  → bullets merged, deduped, into Discipline
//
// A tool with no snippet is callable but unadvertised. `only` narrows the set —
// that is the prompt diet: a disabled tool costs zero prefix tokens instead of
// sitting in the preamble of every request forever.
/**
 * Builds the "Available tools" prompt section for the tools an agent is offered.
 *
 * Opt-in tools (`optIn: true`) appear only when `only` names them.
 * @param opts.protocol Tool-call protocol: `markers` adds each tool's wire-format block, `json` lists snippets only.
 * @param opts.only Tool names (wire or bare) to keep, usually agent.tools; empty keeps every tool that is not opt-in.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Tool-call protocol: `markers` adds each tool's wire-format block, `json` lists snippets only. */
        protocol?: "markers" | "json";
        /** Tool names (wire or bare) to keep, usually agent.tools; empty keeps every tool that is not opt-in. */
        only?: string[];
    } = {},
): string {
    const protocol = opts.protocol ?? "markers";
    let tools = ctx.fns.tools.list({});
    if (opts.only?.length) tools = tools.filter((t: any) => opts.only!.includes(t.wireName) || opts.only!.includes(t.name));
    // An opt-in tool ships only when the agent named it; without a list it stays out.
    else tools = tools.filter((t: any) => !t.optIn);

    const advertised = tools.filter((t: any) => t.promptSnippet);
    const index = advertised.length
        ? advertised.map((t: any) => `- ${label(t, protocol)} — ${t.promptSnippet}`).join("\n")
        : "(none)";

    const out: string[] = ["## Available tools", "", index];

    if (protocol === "markers") {
        const docs = tools.map((t: any) => String(t.doc ?? "").trim()).filter(Boolean);
        if (docs.length) out.push("", "## Marker bodies", "", docs.join("\n\n"));
    }

    const seen = new Set<string>();
    const guidelines = tools.flatMap((t: any) => t.promptGuidelines ?? [])
        .filter((g: string) => (seen.has(g) ? false : (seen.add(g), true)));
    if (guidelines.length) out.push("", "## Tool discipline", "", guidelines.map((g: string) => `- ${g}`).join("\n"));

    return out.join("\n");
}

// In markers mode a tool is named by the marker you type; in JSON mode by the
// function name the provider will accept.
function label(tool: any, protocol: string): string {
    if (protocol === "markers" && tool.marker) return `\`§${tool.marker}\``;
    return `\`${tool.wireName}\``;
}
