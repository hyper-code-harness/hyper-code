import path from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Captures the macOS screen, a region or one app window to a PNG, optionally with OCR text boxes in screen coordinates.
 *
 * Use to see what the Accessibility tree cannot show (web content, canvas, images) or to verify the result of an action; read the returned path to view the image. With ocr true, Apple Vision text lines are returned with click-ready centers in screen points for desktop.click. Requires Screen Recording permission.
 * @param opts.path Output PNG path. Defaults to a timestamped file in the system temp directory.
 * @param opts.app Capture only the first window of this application (name, bundle id or pid).
 * @param opts.region Capture only this rectangle in screen points.
 * @param opts.ocr Run Apple Vision OCR and return text lines with screen-point centers. @default false
 * @param opts.maxWidth Downscale the saved image to at most this many pixels wide to keep it small for the model; 0 keeps full resolution. @default 1600 @minimum 0 @maximum 8000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Output PNG path. Defaults to a timestamped file in the system temp directory. */
        path?: string;
        /** Capture only the first window of this application (name, bundle id or pid). */
        app?: string;
        /** Capture only this rectangle in screen points. */
        region?: { x: number; y: number; w: number; h: number };
        /** Run Apple Vision OCR and return text lines with screen-point centers. @default false */
        ocr?: boolean;
        /** Downscale the saved image to at most this many pixels wide to keep it small for the model; 0 keeps full resolution. @default 1600 @minimum 0 @maximum 8000 */
        maxWidth?: number;
    },
): Promise<{ path: string; origin: { x: number; y: number; w: number; h: number }; width: number; height: number; lines?: Array<{ text: string; confidence: number; x: number; y: number; box: { x: number; y: number; w: number; h: number } }> }> {
    const out = opts.path ?? path.join(process.env.TMPDIR ?? "/tmp", `desktop-${Date.now()}.png`);
    await mkdir(path.dirname(out), { recursive: true });
    const chk = await ctx.fns.desktop.helper({ args: ["check"] }) as { screens: Array<{ x: number; y: number; w: number; h: number }> };
    let rect = opts.region;
    if (!rect && opts.app) {
        const w = await ctx.fns.desktop.windows({ app: opts.app });
        const first = w.windows.find(x => !x.minimized && x.frame);
        if (!first?.frame) throw new Error(`desktop.screenshot: ${opts.app} has no visible window`);
        rect = first.frame;
    }
    const origin = rect ?? chk.screens[0] ?? { x: 0, y: 0, w: 0, h: 0 };
    const args = ["-x", "-t", "png"];
    if (rect) args.push(`-R${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`);
    else args.push("-m");
    const cap = await Bun.$`screencapture ${args} ${out}`.quiet().nothrow();
    if (cap.exitCode !== 0 || !(await Bun.file(out).exists())) throw new Error(`desktop.screenshot: screencapture failed (Screen Recording permission?): ${cap.stderr.toString().trim()}`);
    let lines;
    if (opts.ocr) {
        const r = await ctx.fns.vision.appleOcr({ path: out, level: "accurate" });
        lines = r.lines.map(l => {
            const box = { x: origin.x + l.box.x * origin.w, y: origin.y + l.box.y * origin.h, w: l.box.w * origin.w, h: l.box.h * origin.h };
            const r2 = (n: number) => Math.round(n);
            return { text: l.text, confidence: Math.round(l.confidence * 100) / 100, x: r2(box.x + box.w / 2), y: r2(box.y + box.h / 2), box: { x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h) } };
        });
    }
    const size = async () => {
        const t = (await Bun.$`sips -g pixelWidth -g pixelHeight ${out}`.quiet().nothrow()).stdout.toString();
        return { width: Number(/pixelWidth: (\d+)/.exec(t)?.[1] ?? 0), height: Number(/pixelHeight: (\d+)/.exec(t)?.[1] ?? 0) };
    };
    let { width, height } = await size();
    const maxWidth = opts.maxWidth ?? 1600;
    if (maxWidth > 0 && width > maxWidth) {
        await Bun.$`sips --resampleWidth ${maxWidth} ${out}`.quiet().nothrow();
        ({ width, height } = await size());
    }
    return { path: out, origin, width, height, ...(lines ? { lines } : {}) };
}
