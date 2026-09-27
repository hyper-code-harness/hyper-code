/**
 * Types Unicode text into the focused element of the frontmost macOS application with synthetic keyboard events.
 *
 * Works regardless of keyboard layout (Cyrillic, emoji included). Input goes to whatever has focus, so activate the app and focus the field first (desktop.activate, desktop.press or desktop.click). Prefer desktop.setValue for plain text fields. Requires Accessibility permission.
 * @param opts.text Text to type.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Text to type. */
        text: string;
    },
): Promise<{ ok: boolean; chars: number }> {
    await ctx.fns.desktop.helper({ args: ["type", opts.text], timeoutMs: 15000 + opts.text.length * 20 });
    return { ok: true, chars: opts.text.length };
}
