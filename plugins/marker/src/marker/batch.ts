/** Converts a directory of PDFs with page-aware routing, checksum resume, and a durable batch index.
 * Use for local document collections. Outputs stay outside the source directory by default,
 * failures do not stop the batch, and medical-looking numeric tables are flagged for review.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Absolute directory containing PDF files. */
        inputDir: string;
        /** Absolute batch output directory. Defaults to ~/Documents/marker-output/batch-<timestamp>. */
        outputDir?: string;
        /** Include PDFs below nested directories. @default false */
        recursive?: boolean;
        /** Maximum number of PDFs processed in this invocation. @default 1000 @minimum 1 @maximum 10000 */
        limit?: number;
        /** Resume successful documents with the same source SHA-256 from index.json. @default true */
        resume?: boolean;
        /** Conversion strategy applied to every file; auto probes and routes each PDF. @default "auto" */
        mode?: "auto" | "fast" | "balanced" | "ocr";
        /** Worker count. Keep at one on Apple Silicon because Marker models are memory- and compute-heavy. @default 1 @minimum 1 @maximum 2 */
        concurrency?: number;
        /** Timeout for each Marker attempt. @default 1800 @minimum 30 @maximum 14400 */
        timeoutSeconds?: number;
    },
): Promise<{
    ok: boolean;
    inputDir: string;
    outputDir: string;
    indexPath: string;
    total: number;
    converted: number;
    skipped: number;
    failed: number;
    reviewRequired: number;
    results: Array<{ input: string; status: "converted" | "skipped" | "failed"; sha256?: string; mode?: string; device?: string; durationMs?: number; markdownPath?: string; reviewStatus?: string; warnings?: string[]; error?: string }>;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const inputDir = path.resolve(opts.inputDir);
    const stat = await fs.stat(inputDir).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`marker.batch: inputDir is not a directory: ${inputDir}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "marker-output", `batch-${timestamp}`));
    if (outputDir === inputDir || outputDir.startsWith(`${inputDir}${path.sep}`)) throw new Error("marker.batch: outputDir must be outside inputDir to preserve source data");
    await fs.mkdir(outputDir, { recursive: true });
    const files: string[] = [];
    const walk = async (dir: string) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory() && opts.recursive) await walk(absolute);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(absolute);
        }
    };
    await walk(inputDir);
    files.sort();
    const selected = files.slice(0, Math.max(1, Math.min(10000, opts.limit ?? 1000)));
    const indexPath = path.join(outputDir, "index.json");
    let previous: any = { entries: [] };
    if (opts.resume !== false && await Bun.file(indexPath).exists()) previous = await Bun.file(indexPath).json().catch(() => ({ entries: [] }));
    const completed = new Map<string, any>((previous.entries ?? []).filter((entry: any) => entry.status === "converted" && entry.sha256).map((entry: any) => [entry.sha256, entry]));
    const results: Array<{ input: string; status: "converted" | "skipped" | "failed"; sha256?: string; mode?: string; device?: string; durationMs?: number; markdownPath?: string; reviewStatus?: string; warnings?: string[]; error?: string }> = [];
    let cursor = 0;
    const concurrency = Math.max(1, Math.min(2, opts.concurrency ?? 1));
    const persist = async () => Bun.write(indexPath, JSON.stringify({ plugin: "marker", inputDir, outputDir, updatedAt: new Date().toISOString(), entries: results }, null, 2));
    const worker = async () => {
        while (true) {
            const index = cursor++;
            const input = selected[index];
            if (!input) return;
            try {
                const probe = await ctx.fns.marker.probe({ input });
                const prior = completed.get(probe.sha256);
                if (prior && prior.markdownPath && await Bun.file(prior.markdownPath).exists()) {
                    results[index] = { ...prior, input, status: "skipped" };
                    await persist();
                    continue;
                }
                const safe = path.basename(input, path.extname(input)).normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100);
                const result = await ctx.fns.marker.convert({ input, outputDir: path.join(outputDir, safe), mode: opts.mode ?? "auto", device: "auto", timeoutSeconds: opts.timeoutSeconds });
                results[index] = { input, status: "converted", sha256: probe.sha256, mode: result.mode, device: result.device, durationMs: result.durationMs, markdownPath: result.markdownPath, reviewStatus: result.analysis.reviewStatus, warnings: result.analysis.warnings };
            } catch (error) {
                results[index] = { input, status: "failed", error: String(error).slice(0, 4000) };
            }
            await persist();
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    await persist();
    const compact = results.filter(Boolean);
    return {
        ok: compact.every((entry) => entry.status !== "failed"), inputDir, outputDir, indexPath, total: selected.length,
        converted: compact.filter((entry) => entry.status === "converted").length,
        skipped: compact.filter((entry) => entry.status === "skipped").length,
        failed: compact.filter((entry) => entry.status === "failed").length,
        reviewRequired: compact.filter((entry) => entry.reviewStatus === "manual-verification-required").length,
        results: compact,
    };
}
