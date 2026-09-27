/**
 * Finds UI elements of a macOS app whose role, title, value, description or identifier match a text query.
 *
 * Shortcut over desktop.snapshot when the agent knows what it wants to click or fill ("Save", "Search", "Send"): returns matching elements with ids, frames and actions, ready for desktop.press, desktop.setValue or desktop.click. Case-insensitive substring match; exact label matches are ranked first. Requires Accessibility permission.
 * @param opts.query Text to look for in labels and values, e.g. Save or Search.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.root Subtree root: f (focused window), w<N>, m (menu bar), a (whole app) or an element id. @default f
 * @param opts.role Only return elements with this Accessibility role, with or without the AX prefix, e.g. Button or TextField.
 * @param opts.limit Maximum number of matches. @default 20 @minimum 1 @maximum 200
 * @param opts.maxNodes Maximum number of elements visited. @default 3000 @minimum 10 @maximum 20000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Text to look for in labels and values, e.g. Save or Search. */
        query: string;
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Subtree root: f (focused window), w<N>, m (menu bar), a (whole app) or an element id. @default f */
        root?: string;
        /** Only return elements with this Accessibility role, with or without the AX prefix, e.g. Button or TextField. */
        role?: string;
        /** Maximum number of matches. @default 20 @minimum 1 @maximum 200 */
        limit?: number;
        /** Maximum number of elements visited. @default 3000 @minimum 10 @maximum 20000 */
        maxNodes?: number;
    },
): Promise<Array<{ id: string; role: string; label?: string; value?: string; frame?: { x: number; y: number; w: number; h: number }; actions?: string[]; disabled?: boolean }>> {
    const r = await ctx.fns.desktop.helper({ args: ["tree", opts.app ?? "", opts.root ?? "f", "60", String(opts.maxNodes ?? 3000)], timeoutMs: 60000 }) as { tree: types.desktop.UiNode };
    const q = opts.query.toLowerCase();
    const role = opts.role ? (opts.role.startsWith("AX") ? opts.role : `AX${opts.role}`) : null;
    const hits: Array<{ score: number; id: string; role: string; label?: string; value?: string; frame?: { x: number; y: number; w: number; h: number }; actions?: string[]; disabled?: boolean }> = [];
    const visit = (n: types.desktop.UiNode) => {
        if (!role || n.role === role) {
            const fields = [n.title, n.desc, n.value, n.placeholder, n.help, n.identifier, n.role].filter((x): x is string => !!x);
            const exact = fields.some(f => f.toLowerCase() === q);
            if (exact || fields.some(f => f.toLowerCase().includes(q))) {
                hits.push({ score: (exact ? 2 : 1) + (n.actions?.length ? 0.5 : 0), id: n.id, role: (n.role ?? "").replace(/^AX/, ""), label: n.title ?? n.desc ?? n.placeholder, value: n.value, frame: n.frame, actions: n.actions?.map(a => a.replace(/^AX/, "")), disabled: n.disabled });
            }
        }
        for (const c of n.children ?? []) visit(c);
    };
    visit(r.tree);
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 20).map(({ score, ...h }) => h);
}
