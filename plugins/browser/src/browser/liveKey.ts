// A viewer key event → Input.dispatchKeyEvent parameters. The viewer page is a
// browser too, so it already knows key, code and keyCode; nothing has to be
// reconstructed from X11 keysyms the way a VNC bridge would.

const MAC_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

/**
 * Converts one live-view keyboard event into Chrome DevTools `Input.dispatchKeyEvent` parameters.
 *
 * Printable keys get `text` so the page receives keydown, keypress/beforeinput, input and keyup like
 * real typing; keys held with Ctrl or Meta send no text. Enter types "\r". On a macOS Chrome, Meta (or
 * Ctrl from a non-Mac viewer) with A, C, X, V, Z adds the native editing `commands` Chrome needs there.
 * Returns null for events that must not reach the page (IME composition, dead keys).
 * @param opts.type Key transition from the viewer: `down` or `up`.
 * @param opts.key KeyboardEvent.key, such as `a`, `Ф`, `Enter` or `ArrowLeft`.
 * @param opts.code KeyboardEvent.code, such as `KeyA` or `Enter`.
 * @param opts.keyCode KeyboardEvent.keyCode (Windows virtual key code). @default 0
 * @param opts.location KeyboardEvent.location: 0 standard, 1 left, 2 right, 3 numpad. @default 0
 * @param opts.modifiers CDP modifier mask: Alt=1, Ctrl=2, Meta=4, Shift=8. @default 0
 * @param opts.repeat True for auto-repeated keydown. @default false
 * @param opts.remoteMac True when the controlled Chrome runs on macOS. @default false
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Key transition from the viewer: `down` or `up`. */
        type: "down" | "up";
        /** KeyboardEvent.key, such as `a`, `Ф`, `Enter` or `ArrowLeft`. */
        key: string;
        /** KeyboardEvent.code, such as `KeyA` or `Enter`. */
        code: string;
        /** KeyboardEvent.keyCode (Windows virtual key code). @default 0 */
        keyCode?: number;
        /** KeyboardEvent.location: 0 standard, 1 left, 2 right, 3 numpad. @default 0 */
        location?: number;
        /** CDP modifier mask: Alt=1, Ctrl=2, Meta=4, Shift=8. @default 0 */
        modifiers?: number;
        /** True for auto-repeated keydown. @default false */
        repeat?: boolean;
        /** True when the controlled Chrome runs on macOS. @default false */
        remoteMac?: boolean;
    },
): Record<string, unknown> | null {
    const key = String(opts.key ?? "");
    if (!key || key === "Dead" || key === "Process" || key === "Unidentified") return null;
    const modifiers = (opts.modifiers ?? 0) & 15;
    const keyCode = opts.keyCode ?? 0;
    const base: Record<string, unknown> = {
        key, code: String(opts.code ?? ""), modifiers,
        windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
        location: opts.location ?? 0, isKeypad: opts.location === 3,
    };
    if (opts.type === "up") return { type: "keyUp", ...base };

    const chord = (modifiers & 2) !== 0 || (modifiers & 4) !== 0;
    // A single code point (also astral, e.g. emoji) is a character; names like
    // "ArrowLeft" are not.
    const printable = [...key].length === 1;
    const text = chord ? "" : key === "Enter" ? "\r" : printable ? key : "";
    const out: Record<string, unknown> = { type: text ? "keyDown" : "rawKeyDown", ...base, autoRepeat: !!opts.repeat };
    if (text) { out.text = text; out.unmodifiedText = text; }
    if (opts.remoteMac && chord && (modifiers & 1) === 0) {
        const lower = key.toLowerCase();
        const command = lower === "z" && (modifiers & 8) ? "redo" : MAC_COMMANDS[lower];
        if (command) out.commands = [command];
    }
    return out;
}
