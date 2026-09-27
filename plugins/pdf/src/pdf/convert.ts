/** Converts one PDF through the unified LiteParse/Marker/MinerU interface and returns a normalized result.
 * Auto mode first runs the cheap LiteParse text-layer probe: a document where no page needs OCR and no
 * page has a complex layout is parsed locally by LiteParse in milliseconds instead of a GPU pipeline.
 * Otherwise it inspects the document, routes laboratory tables and scans to MinerU,
 * routes digital narrative to Marker, and preserves engine-specific details and provenance.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute source PDF path. */ input: string;
    /** Parser selection. Auto applies the LiteParse fast path plus pdf.inspect routing. @default "auto" */ engine?: "auto" | "lite" | "marker" | "mineru";
    /** Disable the LiteParse fast path in auto mode and always route to Marker/MinerU. @default false */ skipLiteFastPath?: boolean;
    /** Output directory. Defaults to ~/Documents/pdf-output/<name>-<timestamp>. */ outputDir?: string;
    /** MinerU backend when MinerU is selected. @default "vlm-engine" */ mineruBackend?: "vlm-engine" | "pipeline" | "hybrid-engine";
    /** Marker mode when Marker is selected. @default "auto" */ markerMode?: "auto" | "fast" | "balanced" | "ocr";
    /** Abort the parser after this many seconds. @default 1800 @minimum 30 @maximum 14400 */ timeoutSeconds?: number;
}): Promise<{
    ok: true; input: string; engine: "lite" | "marker" | "mineru"; outputDir: string; markdownPath: string; manifestPath: string;
    durationMs: number; inspection: Awaited<ReturnType<typeof ctx.fns.pdf.inspect>> | null;
    complexity: Awaited<ReturnType<typeof ctx.fns.pdf.needsOcr>>;
    analysis: Awaited<ReturnType<typeof ctx.fns.marker.analyze>>;
    reviewStatus: "pass" | "review" | "manual-verification-required";
    provenance: { sourceSha256: string; parser: string; generatedFigureDescriptionsPossible: boolean };
    details: Record<string, any>;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const source = path.resolve(opts.input);
    const complexity = await ctx.fns.pdf.needsOcr({ input: source });
    const liteEligible = complexity.ok && !complexity.needsOcr && complexity.complexLayoutPages.length === 0;
    const requested = opts.engine ?? "auto";
    const useLite = requested === "lite" || (requested === "auto" && !opts.skipLiteFastPath && liteEligible);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stem = path.basename(source, path.extname(source)).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100);
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "pdf-output", `${stem}-${timestamp}`));
    if (useLite) {
        const lite = await ctx.fns.pdf.parseLite({ input: source, outputDir, format: "markdown", timeoutSeconds: Math.min(opts.timeoutSeconds ?? 300, 3600) });
        if (lite.ok) {
            const analysis = await ctx.fns.marker.analyze({ markdownPath: lite.outputPath, sourcePdf: source });
            const manifestPath = path.join(outputDir, "manifest.json");
            await fs.writeFile(manifestPath, JSON.stringify({ input: source, engine: "lite", parser: lite.parser, sourceSha256: lite.sourceSha256, complexity: { verdict: complexity.verdict, pageCount: complexity.pageCount, reasons: complexity.reasons }, generatedAt: new Date().toISOString() }, null, 2));
            return { ok: true, input: source, engine: "lite", outputDir, markdownPath: lite.outputPath, manifestPath, durationMs: lite.durationMs, inspection: null, complexity, analysis, reviewStatus: analysis.reviewStatus, provenance: { sourceSha256: lite.sourceSha256, parser: "liteparse", generatedFigureDescriptionsPossible: false }, details: { probeMs: complexity.durationMs, textCoverage: complexity.textCoverage, pages: complexity.pageCount, ocrUsed: false } };
        }
        if (requested === "lite") throw new Error(`LiteParse failed: ${lite.error ?? "unknown error"}`);
    }
    const inspection = await ctx.fns.pdf.inspect({ input: source });
    const engine: "marker" | "mineru" = requested === "marker" || requested === "mineru" ? requested : inspection.recommendation.engine;
    if (engine === "marker") {
        const result = await ctx.fns.marker.convert({ input: inspection.input, outputDir, mode: opts.markerMode ?? "auto", device: "auto", timeoutSeconds: opts.timeoutSeconds });
        return { ok: true, input: inspection.input, engine, outputDir, markdownPath: result.markdownPath, manifestPath: result.manifestPath, durationMs: result.durationMs, inspection, complexity, analysis: result.analysis, reviewStatus: result.analysis.reviewStatus, provenance: { sourceSha256: result.probe.sha256, parser: `marker-pdf`, generatedFigureDescriptionsPossible: false }, details: { mode: result.mode, device: result.device, fallbackReason: result.fallbackReason ?? null, artifacts: result.artifacts } };
    }
    const result = await ctx.fns.mineru.convert({ input: inspection.input, outputDir, backend: opts.mineruBackend ?? "vlm-engine", timeoutSeconds: opts.timeoutSeconds });
    return { ok: true, input: inspection.input, engine, outputDir, markdownPath: result.markdownPath, manifestPath: result.manifestPath, durationMs: result.durationMs, inspection, complexity, analysis: result.analysis, reviewStatus: result.analysis.reviewStatus, provenance: { sourceSha256: result.sourceSha256, parser: `mineru:${result.backend}`, generatedFigureDescriptionsPossible: result.backend !== "pipeline" }, details: { backend: result.backend, artifacts: result.artifacts } };
}
