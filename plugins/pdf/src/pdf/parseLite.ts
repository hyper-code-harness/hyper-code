/**
 * Extracts Markdown from a document locally with LiteParse without OCR, LLM or GPU
 *
 * Runs the local LiteParse CLI (`lit parse`) over a PDF, DOCX, XLSX, PPTX or image and writes layout-preserving Markdown in milliseconds per page, with no OCR, no model and no cloud call. Use for born-digital documents that pdf.needsOcr reported as SIMPLE, and as the cheap branch of pdf.convert before falling back to Marker or MinerU.
 * @param opts.input Absolute or workspace-relative path to the source document.
 * @param opts.outputDir Directory for the Markdown output. Defaults to ~/Documents/pdf-output/<stem>-lite-<timestamp>.
 * @param opts.format LiteParse output format. @default markdown
 * @param opts.ocr Allow LiteParse's bundled Tesseract OCR instead of running text-layer only. @default false
 * @param opts.targetPages Page selection expression such as "1-5,10".
 * @param opts.timeoutSeconds Abort LiteParse after this many seconds. @default 300 @minimum 5 @maximum 3600
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute or workspace-relative path to the source document. */
        input: string;
        /** Directory for the Markdown output. Defaults to ~/Documents/pdf-output/<stem>-lite-<timestamp>. */
        outputDir?: string;
        /** LiteParse output format. @default markdown */
        format?: "markdown" | "text" | "json";
        /** Allow LiteParse's bundled Tesseract OCR instead of running text-layer only. @default false */
        ocr?: boolean;
        /** Page selection expression such as "1-5,10". */
        targetPages?: string;
        /** Abort LiteParse after this many seconds. @default 300 @minimum 5 @maximum 3600 */
        timeoutSeconds?: number;
    },
): Promise<{
    ok: boolean;
    input: string;
    outputPath: string;
    format: "markdown" | "text" | "json";
    characters: number;
    words: number;
    durationMs: number;
    sourceSha256: string;
    ocrUsed: boolean;
    parser: string;
    error?: string;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    const started = Date.now();
    const format = opts.format ?? "markdown";
    const ocr = opts.ocr ?? false;
    const fail = (error: string, outputPath = "") => ({ ok: false as const, input, outputPath, format, characters: 0, words: 0, durationMs: Date.now() - started, sourceSha256: "", ocrUsed: ocr, parser: "liteparse", error });
    if (!(await fs.access(input).then(() => true, () => false))) return fail(`Input file not found: ${input}`);
    const binary = await ctx.fns.pdf.litBin({});
    if (!binary) return fail("LiteParse CLI 'lit' was not found; install it with 'uv tool install liteparse'.");
    const stem = path.basename(input, path.extname(input)).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "pdf-output", `${stem}-lite-${timestamp}`));
    await fs.mkdir(outputDir, { recursive: true });
    const extension = format === "json" ? "json" : format === "text" ? "txt" : "md";
    const outputPath = path.join(outputDir, `${stem}.${extension}`);
    const args = [binary, "parse", input, "--format", format, "-o", outputPath];
    if (!ocr) args.push("--no-ocr");
    if (opts.targetPages) args.push("--target-pages", opts.targetPages);
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: process.env });
    const timer = setTimeout(() => proc.kill(), (opts.timeoutSeconds ?? 300) * 1000);
    const [, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    const durationMs = Date.now() - started;
    if (code !== 0 || !(await fs.access(outputPath).then(() => true, () => false))) {
        return { ...fail(stderr.trim().split("\n").filter((l) => !l.startsWith("[liteparse]")).join(" ") || `lit parse exited with code ${code}`, outputPath), durationMs };
    }
    const content = await fs.readFile(outputPath, "utf8");
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await fs.readFile(input));
    return {
        ok: true,
        input,
        outputPath,
        format,
        characters: content.length,
        words: (content.match(/[\p{L}\p{N}]+/gu) ?? []).length,
        durationMs,
        sourceSha256: hasher.digest("hex"),
        ocrUsed: ocr,
        parser: "liteparse",
    };
}
