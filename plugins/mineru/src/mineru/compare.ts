/** Compares MinerU and Marker Markdown generated from the same PDF using shared structural and clinical-risk metrics.
 * Use for evidence-based parser selection on representative documents. Existing output paths may be supplied
 * to avoid reruns; otherwise both parsers execute locally with their recommended defaults.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute source PDF path. */ input: string;
    /** Existing MinerU Markdown path; omit to run MinerU VLM locally. */ mineruMarkdownPath?: string;
    /** Existing Marker Markdown path; omit to run Marker in auto mode. */ markerMarkdownPath?: string;
    /** Root for newly generated comparison artifacts. Defaults to ~/Documents/pdf-parser-comparison/<name>-<timestamp>. */ outputDir?: string;
    /** Timeout for each parser execution. @default 1800 @minimum 30 @maximum 14400 */ timeoutSeconds?: number;
}): Promise<{
    input: string; outputDir: string;
    mineru: { markdownPath: string; durationMs: number | null; analysis: Awaited<ReturnType<typeof ctx.fns.marker.analyze>> };
    marker: { markdownPath: string; durationMs: number | null; analysis: Awaited<ReturnType<typeof ctx.fns.marker.analyze>> };
    comparison: { characterRatio: number; wordRatio: number; numericTokenDelta: number; imageDelta: number; tableRowDelta: number; recommendation: "mineru" | "marker" | "manual-review"; reasons: string[] };
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    if (!(await Bun.file(input).exists())) throw new Error(`mineru.compare: input not found: ${input}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stem = path.basename(input, path.extname(input)).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100);
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "pdf-parser-comparison", `${stem}-${timestamp}`));
    await fs.mkdir(outputDir, { recursive: true });
    let mineruDuration: number | null = null, markerDuration: number | null = null;
    let mineruMarkdownPath = opts.mineruMarkdownPath ? path.resolve(opts.mineruMarkdownPath) : "";
    let markerMarkdownPath = opts.markerMarkdownPath ? path.resolve(opts.markerMarkdownPath) : "";
    if (!mineruMarkdownPath) { const result = await ctx.fns.mineru.convert({ input, outputDir: path.join(outputDir, "mineru"), backend: "vlm-engine", timeoutSeconds: opts.timeoutSeconds }); mineruMarkdownPath = result.markdownPath; mineruDuration = result.durationMs; }
    if (!markerMarkdownPath) { const result = await ctx.fns.marker.convert({ input, outputDir: path.join(outputDir, "marker"), mode: "auto", device: "auto", timeoutSeconds: opts.timeoutSeconds }); markerMarkdownPath = result.markdownPath; markerDuration = result.durationMs; }
    const [mineruAnalysis, markerAnalysis] = await Promise.all([ctx.fns.marker.analyze({ markdownPath: mineruMarkdownPath, sourcePdf: input }), ctx.fns.marker.analyze({ markdownPath: markerMarkdownPath, sourcePdf: input })]);
    const reasons: string[] = [];
    if (mineruAnalysis.reviewStatus !== "pass" || markerAnalysis.reviewStatus !== "pass") reasons.push("At least one parser requires review; clinical facts must be checked against the source PDF.");
    const mineruRisk = mineruAnalysis.quality.tables + mineruAnalysis.quality.clinicalSafety;
    const markerRisk = markerAnalysis.quality.tables + markerAnalysis.quality.clinicalSafety;
    const mineruTableRows = mineruAnalysis.tables.pipeRows + mineruAnalysis.tables.htmlRows;
    const markerTableRows = markerAnalysis.tables.pipeRows + markerAnalysis.tables.htmlRows;
    if (mineruRisk > markerRisk + 10) reasons.push("MinerU has materially stronger table and clinical-safety heuristics.");
    if (markerRisk > mineruRisk + 10) reasons.push("Marker has materially stronger table and clinical-safety heuristics.");
    if (mineruAnalysis.clinicalChecks.numericTokens > markerAnalysis.clinicalChecks.numericTokens * 1.2) reasons.push("MinerU extracted substantially more numeric tokens; verify whether these are source values or generated figure descriptions.");
    if (markerAnalysis.clinicalChecks.numericTokens > mineruAnalysis.clinicalChecks.numericTokens * 1.2) reasons.push("Marker extracted substantially more numeric tokens; verify completeness and column alignment.");
    const recommendation: "mineru" | "marker" | "manual-review" = mineruAnalysis.reviewStatus === "manual-verification-required" && markerAnalysis.reviewStatus === "manual-verification-required" ? "manual-review" : mineruRisk > markerRisk + 10 ? "mineru" : markerRisk > mineruRisk + 10 ? "marker" : "manual-review";
    return { input, outputDir, mineru: { markdownPath: mineruMarkdownPath, durationMs: mineruDuration, analysis: mineruAnalysis }, marker: { markdownPath: markerMarkdownPath, durationMs: markerDuration, analysis: markerAnalysis }, comparison: { characterRatio: Number((mineruAnalysis.characters / Math.max(1, markerAnalysis.characters)).toFixed(3)), wordRatio: Number((mineruAnalysis.words / Math.max(1, markerAnalysis.words)).toFixed(3)), numericTokenDelta: mineruAnalysis.clinicalChecks.numericTokens - markerAnalysis.clinicalChecks.numericTokens, imageDelta: mineruAnalysis.images.references - markerAnalysis.images.references, tableRowDelta: mineruTableRows - markerTableRows, recommendation, reasons } };
}
