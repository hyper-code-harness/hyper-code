/**
 * Presses keyboard shortcuts and special keys in the frontmost macOS application.
 *
 * Each entry is a combo like cmd+s, cmd+shift+n, return, escape, tab, up, pagedown, f5 or a single character; entries are pressed in order. Modifiers: cmd, shift, alt/option, ctrl, fn. Keys follow the US layout positions. Requires Accessibility permission.
 * @param opts.keys Key combos pressed one after another, e.g. ["cmd+a", "delete"].
 * @param opts.waitMs Pause after the last key so the UI settles. @default 300 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Key combos pressed one after another, e.g. ["cmd+a", "delete"]. */
        keys: string[];
        /** Pause after the last key so the UI settles. @default 300 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; keys: string[] }> {
    await ctx.fns.desktop.helper({ args: ["key", ...opts.keys] });
    await Bun.sleep(opts.waitMs ?? 300);
    return { ok: true, keys: opts.keys };
}
