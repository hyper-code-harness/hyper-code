import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Creates or replaces an Excalidraw drawing from elements, a simple skeleton or Mermaid source.
 *
 * Use when an agent should sketch a diagram the user will open and edit by hand.
 * `elements` are full Excalidraw elements stored as-is. `skeleton` is the
 * simplified element list Excalidraw's convertToExcalidrawElements accepts
 * (`{ type: "rectangle", x, y, label: { text } }`, `{ type: "arrow", start: { id }, end: { id } }`),
 * and `mermaid` is a Mermaid flowchart/sequence/class source; both are converted to
 * real elements by the browser editor the first time the drawing is opened
 * (the preview SVG appears after that first save). Returns the editor URL.
 * @param opts.name Drawing name such as `butler`.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Drawing name: letters, digits, `-`, `_`; no extension. */
    name: string;
    /** Full Excalidraw elements, stored unchanged. */
    elements?: Record<string, unknown>[];
    /** Simplified ExcalidrawElementSkeleton list, converted in the editor on first open. */
    skeleton?: Record<string, unknown>[];
    /** Mermaid diagram source, converted in the editor on first open. */
    mermaid?: string;
    /** Scene appState overrides such as viewBackgroundColor. */
    appState?: Record<string, unknown>;
}): Promise<{ name: string; path: string; url: string; pending: boolean }> {
    const given = [opts.elements, opts.skeleton, opts.mermaid].filter(v => v != null).length;
    if (given !== 1) throw new Error("excalidraw.write: pass exactly one of elements, skeleton or mermaid");
    const f = await ctx.fns.excalidraw.file({ name: opts.name });
    const scene: Record<string, unknown> = {
        type: "excalidraw", version: 2, source: "hyper",
        elements: opts.elements ?? [],
        appState: { viewBackgroundColor: "#ffffff", ...(opts.appState ?? {}) },
        files: {},
    };
    if (opts.skeleton) scene.hyperSkeleton = opts.skeleton;
    if (opts.mermaid) scene.hyperMermaid = String(opts.mermaid);
    await mkdir(dirname(f.scene), { recursive: true });
    await Bun.write(f.scene, JSON.stringify(scene, null, 2));
    // The old preview no longer matches the scene; the editor re-exports it on the next save.
    await unlink(f.svg).catch((e: any) => { if (e?.code !== "ENOENT") throw e; });
    return { name: f.name, path: f.scene, url: `/excalidraw/${f.name}`, pending: Boolean(opts.skeleton || opts.mermaid) };
}
