/**
 * Captures the Accessibility UI tree of a macOS app window or menu bar as a compact outline with actionable element ids.
 *
 * Primary way for an agent to "see" a native app without pixels: every line is `id role "label" = value [actions]`. Pass an id to desktop.press, desktop.setValue or desktop.click({ id }). Ids are child-index paths from a root (f = focused window, w0..wN = windows, m = menu bar, a = whole app) and go stale when the UI changes, so snapshot again after each action. Empty structural groups are hidden from the outline but kept in `tree`. Requires Accessibility permission; Electron/canvas apps may expose little and then need desktop.screenshot with OCR.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.root Subtree root: f (focused window), w<N> (window N), m (menu bar), a (application) or any element id from a previous snapshot. @default f
 * @param opts.maxDepth Maximum depth below the root. @default 25 @minimum 1 @maximum 60
 * @param opts.maxNodes Maximum number of elements visited. @default 600 @minimum 10 @maximum 5000
 * @param opts.includeTree Also return the raw nested tree (large). @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Subtree root: f (focused window), w<N> (window N), m (menu bar), a (application) or any element id from a previous snapshot. @default f */
        root?: string;
        /** Maximum depth below the root. @default 25 @minimum 1 @maximum 60 */
        maxDepth?: number;
        /** Maximum number of elements visited. @default 600 @minimum 10 @maximum 5000 */
        maxNodes?: number;
        /** Also return the raw nested tree (large). @default false */
        includeTree?: boolean;
    },
): Promise<{ app: string; pid: number; root: string; nodes: number; truncated: boolean; outline: string; tree?: types.desktop.UiNode }> {
    const r = await ctx.fns.desktop.helper({
        args: ["tree", opts.app ?? "", opts.root ?? "f", String(opts.maxDepth ?? 25), String(opts.maxNodes ?? 600)],
        timeoutMs: 30000,
    }) as { app: string; pid: number; tree: types.desktop.UiNode; budgetExhausted: boolean };
    const lines: string[] = [];
    let count = 0;
    const q = (s: string) => JSON.stringify(s.length > 120 ? s.slice(0, 117) + "..." : s);
    const visit = (n: types.desktop.UiNode, depth: number) => {
        count++;
        const role = (n.role ?? "?").replace(/^AX/, "") + (n.subrole ? `/${n.subrole.replace(/^AX/, "")}` : "");
        const label = n.title ?? n.desc ?? n.placeholder ?? n.help;
        const acts = (n.actions ?? []).map(a => a.replace(/^AX/, "")).filter(a => a !== "Raise" || depth === 0);
        const informative = depth === 0 || label || n.value || acts.length || n.focused || !/^(Group|SplitGroup|ScrollArea|Unknown|LayoutArea|List|Layout)/.test(role);
        let d = depth;
        if (informative) {
            const parts = [`${"  ".repeat(depth)}${n.id} ${role}`];
            if (label) parts.push(q(label));
            if (n.value && n.value !== label) parts.push(`= ${q(n.value)}`);
            if (acts.length) parts.push(`[${acts.join(",")}]`);
            if (n.disabled) parts.push("(disabled)");
            if (n.focused) parts.push("(focused)");
            if (n.truncated) parts.push("…");
            lines.push(parts.join(" "));
            d = depth + 1;
        }
        for (const c of n.children ?? []) visit(c, d);
    };
    visit(r.tree, 0);
    return {
        app: r.app, pid: r.pid, root: opts.root ?? "f", nodes: count, truncated: r.budgetExhausted,
        outline: lines.join("\n"),
        ...(opts.includeTree ? { tree: r.tree } : {}),
    };
}
