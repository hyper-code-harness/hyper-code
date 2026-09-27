/** Inspects a PDF and recommends Marker or MinerU without performing conversion.
 * Uses per-page embedded-text density plus filename and extracted-text hints to identify
 * laboratory tables, narrative documents, mixed PDFs, and full scans.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path to the source PDF. */ input: string;
}): Promise<{
    input: string;
    probe: Awaited<ReturnType<typeof ctx.fns.marker.probe>>;
    hints: { laboratory: boolean; cardiology: boolean; prescription: boolean; report: boolean; numericDensity: number; sampledCharacters: number };
    recommendation: { engine: "marker" | "mineru"; mode: string; confidence: "high" | "medium"; reason: string };
}> {
    const path = await import("node:path");
    const input = path.resolve(opts.input);
    const probe = await ctx.fns.marker.probe({ input });
    const proc = Bun.spawn(["pdftotext", "-f", "1", "-l", String(Math.min(probe.pages, 3)), input, "-"], { stdout: "pipe", stderr: "pipe" });
    const [sample] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const haystack = `${path.basename(input)}\n${sample}`.normalize("NFKD").toLowerCase();
    const laboratory = /patologia|laborat[oó]rio|hematologia|hemograma|bioqu[ií]mica|resultado.{0,20}(?:unidade|refer[eê]ncia)|hemoglobina|leuc[oó]citos/.test(haystack);
    const cardiology = /cardiologia|electrocardiograma|eletrocardiograma|ecg|frequ[eê]ncia card[ií]aca/.test(haystack);
    const prescription = /prescri[cç][aã]o|receita|medicamento|posologia/.test(haystack);
    const report = /relat[oó]rio|conclus[aã]o|diagn[oó]stico|informa[cç][aã]o cl[ií]nica/.test(haystack);
    const numeric = (sample.match(/\d+(?:[.,]\d+)?/g) ?? []).length;
    const words = (sample.match(/[\p{L}\p{N}]+/gu) ?? []).length;
    const numericDensity = Number((numeric / Math.max(1, words)).toFixed(3));
    let engine: "marker" | "mineru", mode: string, confidence: "high" | "medium", reason: string;
    if (laboratory) {
        engine = "mineru"; mode = "vlm-engine"; confidence = "high";
        reason = "Laboratory/pathology content was detected; MinerU generally preserves multi-column result tables and units better.";
    } else if (probe.classification === "scanned") {
        engine = "mineru"; mode = "vlm-engine"; confidence = "high";
        reason = "All pages lack embedded text; MinerU's MLX VLM is preferred over a long Marker CPU OCR pass.";
    } else if (probe.classification === "mixed" && probe.scannedPages.length > probe.digitalPages.length) {
        engine = "mineru"; mode = "vlm-engine"; confidence = "medium";
        reason = "Most pages lack embedded text; the MLX VLM is likely to provide the best whole-document consistency.";
    } else {
        engine = "marker"; mode = probe.recommendedMode; confidence = cardiology || prescription || report || probe.classification === "digital" ? "high" : "medium";
        reason = "The document is primarily digital narrative content; Marker is faster and less likely to add generated figure interpretations.";
    }
    return { input, probe, hints: { laboratory, cardiology, prescription, report, numericDensity, sampledCharacters: sample.length }, recommendation: { engine, mode, confidence, reason } };
}
