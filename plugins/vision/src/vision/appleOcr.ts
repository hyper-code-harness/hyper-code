/**
 * Recognizes text lines in a local image with macOS Apple Vision.
 *
 * Low-level Apple Vision OCR engine: runs Vision.framework VNRecognizeTextRequest locally via osascript JXA, offline and free, returning each text line with confidence, a normalized top-left bounding box and a rotated quad. macOS only. Prefer vision.ocr, which adds row reconstruction and engine selection.
 * @param opts.path Absolute or server-relative path to a PNG, JPEG, HEIC, TIFF or other ImageIO-readable image.
 * @param opts.langs Recognition languages as BCP-47 tags in priority order. Defaults to ru-RU, en-US, pt-PT.
 * @param opts.level Vision recognition level: accurate uses the neural model with language correction, fast is quicker but weaker. @default accurate
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute or server-relative path to a PNG, JPEG, HEIC, TIFF or other ImageIO-readable image. */
        path: string;
        /** Recognition languages as BCP-47 tags in priority order. Defaults to ru-RU, en-US, pt-PT. */
        langs?: string[];
        /** Vision recognition level: accurate uses the neural model with language correction, fast is quicker but weaker. @default accurate */
        level?: "accurate" | "fast";
    },
): Promise<{ engine: "apple"; path: string; langs: string[]; level: "accurate" | "fast"; durationMs: number; lines: types.vision.OcrLine[] }> {
    const path = await import("node:path");
    const input = path.resolve(opts.path);
    if (!(await Bun.file(input).exists())) throw new Error(`vision.appleOcr: image not found: ${input}`);
    if (process.platform !== "darwin") throw new Error("vision.appleOcr: Apple Vision requires macOS");
    const script = path.join(import.meta.dir, "..", "..", "script", "apple-ocr.js");
    const langs = opts.langs?.length ? opts.langs : ["ru-RU", "en-US", "pt-PT"];
    const level = opts.level ?? "accurate";
    const started = performance.now();
    const proc = await Bun.$`osascript -l JavaScript ${script} ${input} ${langs.join(",")} ${level}`.quiet().nothrow();
    if (proc.exitCode !== 0) throw new Error(`vision.appleOcr: osascript failed: ${proc.stderr.toString().trim()}`);
    const parsed = JSON.parse(proc.stdout.toString()) as { error?: string; lines?: types.vision.OcrLine[] };
    if (parsed.error) throw new Error(`vision.appleOcr: ${parsed.error}`);
    return { engine: "apple" as const, path: input, langs, level, durationMs: Math.round(performance.now() - started), lines: parsed.lines ?? [] };
}
