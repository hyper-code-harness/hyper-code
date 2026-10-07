/**
 * Reads an Excalidraw drawing: its scene JSON, a compact text outline of shapes and labels, and the preview SVG if saved.
 *
 * Use to see what the user drew or changed in the editor — the outline lists every
 * shape with its label and every arrow with the labels it connects, without the
 * coordinates noise of the raw scene.
 * @param opts.name Drawing name such as `butler`.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Drawing name: letters, digits, `-`, `_`; no extension. */
    name: string;
    /** Include the full scene JSON in the result. @default false */
    scene?: boolean;
}): Promise<{ name: string; exists: boolean; outline: string[]; elements: number; pending: boolean; svg: string | null; scene?: unknown }> {
    const f = await ctx.fns.excalidraw.file({ name: opts.name });
    const file = Bun.file(f.scene);
    if (!(await file.exists())) return { name: f.name, exists: false, outline: [], elements: 0, pending: false, svg: null };
    const data: any = await file.json();
    const els: any[] = (data.elements ?? []).filter((e: any) => !e.isDeleted);
    const byId = new Map(els.map(e => [e.id, e]));
    const textOf = (e: any): string => {
        if (!e) return "?";
        if (e.type === "text") return String(e.text ?? "");
        const bound = (e.boundElements ?? []).map((b: any) => byId.get(b.id)).find((t: any) => t?.type === "text");
        return String(bound?.text ?? e.label?.text ?? `${e.type}#${String(e.id).slice(0, 4)}`);
    };
    const outline: string[] = [];
    for (const e of els) {
        if (e.type === "text" && e.containerId) continue;
        if (e.type === "arrow" || e.type === "line") {
            const from = textOf(byId.get(e.startBinding?.elementId)), to = textOf(byId.get(e.endBinding?.elementId));
            const label = (e.boundElements ?? []).map((b: any) => byId.get(b.id)).find((t: any) => t?.type === "text")?.text;
            outline.push(`${e.type}: ${from} -> ${to}${label ? ` "${label}"` : ""}`.replace(/\s+/g, " "));
        } else outline.push(`${e.type}: ${textOf(e).replace(/\s+/g, " ")}`);
    }
    const svgFile = Bun.file(f.svg);
    const svg = (await svgFile.exists()) ? await svgFile.text() : null;
    return {
        name: f.name, exists: true, outline, elements: els.length,
        pending: Boolean(data.hyperSkeleton || data.hyperMermaid), svg,
        ...(opts.scene ? { scene: data } : {}),
    };
}
