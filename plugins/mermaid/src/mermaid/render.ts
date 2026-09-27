import { renderMermaid } from "beautiful-mermaid";

const CLASS_DEFS: Record<string, { fill: string; stroke: string }> = {
    red: { fill: "#fef2f2", stroke: "#F58685" },
    blue: { fill: "#eff6ff", stroke: "#7DA1EF" },
    violet: { fill: "#faf5ff", stroke: "#AB8AE3" },
    green: { fill: "#f0fdf4", stroke: "#78B58E" },
    yellow: { fill: "#fefce8", stroke: "#E4BE6F" },
    neutral: { fill: "#F5F5F6", stroke: "#CCCED3" },
};

function stripFontImports(svg: string): string {
    return svg.replace(/@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\);?\s*/g, "");
}

export function injectClassDefs(code: string): string {
    const usedClasses = new Set<string>();
    for (const m of code.matchAll(/^\s*class\s+[\w]+(?:\s*,\s*[\w]+)*\s+(\w+)\s*$/gm)) usedClasses.add(m[1]!);
    for (const m of code.matchAll(/:::(\w+)/g)) usedClasses.add(m[1]!);
    if (usedClasses.size === 0) return code;
    const definedClasses = new Set<string>();
    for (const m of code.matchAll(/^\s*classDef\s+(\w+)/gm)) definedClasses.add(m[1]!);
    const defs: string[] = [];
    for (const cls of usedClasses) {
        if (definedClasses.has(cls)) continue;
        const match = cls.match(/^(\w+?)(\d)$/);
        if (!match) continue;
        const base = match[1]!;
        const width = match[2]!;
        const colors = CLASS_DEFS[base];
        if (!colors) continue;
        defs.push("    classDef " + cls + " fill:" + colors.fill + ",stroke:" + colors.stroke + ",stroke-width:" + width + "px");
    }
    if (defs.length === 0) return code;
    return code + "\n" + defs.join("\n");
}

/**
 * Renders Mermaid diagram source to an inline, responsive SVG HTML fragment.
 *
 * Use to turn Mermaid (flowchart, sequence, state, class, ER diagrams) into
 * markup for chat answers, docs or pages; ```mermaid fences in Markdown go
 * through this function automatically. Palette classes such as `:::blue2` or
 * `class A red1` get their classDef injected. Invalid source throws.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Mermaid diagram source, without the surrounding ``` fence. */
    source: string;
}): Promise<string> {
    const svg = await renderMermaid(injectClassDefs(opts.source), {
        bg: "#ffffff",
        fg: "#1D2331",
        line: "#717684",
        muted: "#717684",
        surface: "#F5F5F6",
        border: "#CCCED4",
        font: "Inter, verdana",
        transparent: true,
    });
    // Layout lives in $style_mermaid.css, shipped with this plugin.
    const responsive = stripFontImports(svg)
        .replace(/<svg\b([^>]*)\swidth="([^"]+)"\sheight="[^"]+"([^>]*)>/, '<svg$1$3 width="$2" height="auto" preserveAspectRatio="xMinYMin meet">');
    return "<div class=\"mermaid-diagram\"><span class=\"mermaid-light\" data-ignore>" + responsive + "</span></div>";
}
