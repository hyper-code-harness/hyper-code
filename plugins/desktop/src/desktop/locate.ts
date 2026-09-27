/**
 * Finds where to act in a window: an Accessibility element index or a screenshot pixel point for a visible text label.
 *
 * Resolution order for text: Accessibility elements whose label, value or identifier match (exact before substring, actionable first), then Apple Vision OCR of a fresh window screenshot. Used by desktop.click, desktop.type and friends when they get text instead of element or x/y; call it directly to preview what would be hit.
 * @param opts.text Visible label or text to find, case-insensitive, e.g. Send, Save, ask-a-question.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.role Only accept Accessibility elements of this role, e.g. AXButton or AXTextField.
 * @param opts.nth Which match to use when several match, 0-based. @default 0 @minimum 0
 * @param opts.ocrOnly Skip the Accessibility tree and match OCR text only. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Visible label or text to find, case-insensitive, e.g. Send, Save, ask-a-question. */
        text: string;
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Case-insensitive substring of the window title. */
        window?: string;
        /** Exact CGWindowID from a previous desktop result; wins over window. */
        windowId?: number;
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Only accept Accessibility elements of this role, e.g. AXButton or AXTextField. */
        role?: string;
        /** Which match to use when several match, 0-based. @default 0 @minimum 0 */
        nth?: number;
        /** Skip the Accessibility tree and match OCR text only. @default false */
        ocrOnly?: boolean;
    },
): Promise<{ target: types.desktop.AppWindow; via: "element" | "ocr"; element?: number; x?: number; y?: number; label: string; candidates: number }> {
    const q = opts.text.toLowerCase();
    const nth = opts.nth ?? 0;
    if (!opts.ocrOnly) {
        const l = await ctx.fns.desktop.look({ app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, screenshot: false, query: opts.text, maxChars: 200 });
        const snaps: Map<string, any> = (globalThis as any).__desktopCuaSnaps ?? new Map();
        const els: any[] = snaps.get(`${l.target.host}:${l.target.pid}:${l.target.windowId}`)?.elements ?? [];
        const role = opts.role ? (opts.role.startsWith("AX") ? opts.role : `AX${opts.role}`) : null;
        const scored = els
            .filter(e => typeof e.element_index === "number" && (!role || e.role === role))
            .map(e => {
                const fields = [e.label, e.value, e.title, e.identifier, e.description].filter((x: unknown): x is string => typeof x === "string").map(x => x.toLowerCase());
                const exact = fields.some(f => f === q), sub = fields.some(f => f.includes(q));
                return { e, score: exact ? 3 : sub ? 1 : 0 };
            })
            .filter(x => x.score > 0)
            .map(x => ({ ...x, score: x.score + (x.e.actions?.length ? 0.5 : 0) }))
            .sort((a, b) => b.score - a.score);
        const hit = scored[nth];
        if (hit) return { target: l.target, via: "element", element: hit.e.element_index, label: hit.e.label ?? hit.e.value ?? opts.text, candidates: scored.length };
    }
    const l = await ctx.fns.desktop.look({ app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, tree: false, ocr: true });
    const lines = l.ocr ?? [];
    const matches = [...lines.filter(x => x.text.toLowerCase() === q), ...lines.filter(x => x.text.toLowerCase() !== q && x.text.toLowerCase().includes(q))];
    const m = matches[nth];
    if (!m) throw new Error(`desktop.locate: "${opts.text}" not found in ${l.target.app} "${l.title}" (Accessibility or OCR)`);
    return { target: l.target, via: "ocr", x: m.x, y: m.y, label: m.text, candidates: matches.length };
}
