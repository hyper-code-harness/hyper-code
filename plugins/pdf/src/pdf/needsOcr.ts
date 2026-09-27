/**
 * Checks cheaply whether a document needs OCR before running a heavy PDF parser
 *
 * Runs the local LiteParse `lit is-complex` text-layer-only probe on a PDF, DOCX, XLSX, PPTX or image and reports, per page, whether OCR is required and whether the layout is complex. Use as the cheap first routing step before pdf.convert, Marker or MinerU: when no page needs OCR the document can be parsed with a fast text-layer extractor instead of a GPU/VLM pipeline.
 * @param opts.input Absolute or workspace-relative path to the source document.
 * @param opts.maxPages Maximum number of pages probed. @default 1000 @minimum 1 @maximum 10000
 * @param opts.targetPages Page selection expression such as "1-5,10,15-20"; overrides maxPages when given.
 * @param opts.password Password for an encrypted document.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute or workspace-relative path to the source document. */
        input: string;
        /** Maximum number of pages probed. @default 1000 @minimum 1 @maximum 10000 */
        maxPages?: number;
        /** Page selection expression such as "1-5,10,15-20"; overrides maxPages when given. */
        targetPages?: string;
        /** Password for an encrypted document. */
        password?: string;
    },
): Promise<{
    ok: boolean;
    input: string;
    binary: string | null;
    needsOcr: boolean;
    verdict: "SIMPLE" | "COMPLEX" | "unknown";
    pageCount: number;
    pagesNeedingOcr: number[];
    complexLayoutPages: number[];
    reasons: string[];
    textCoverage: number;
    durationMs: number;
    pages: Array<{ page: number; needsOcr: boolean; reasons: string[]; textLength: number; textCoverage: number; complexLayout: boolean; columns: number; tables: number; figures: number }>;
    error?: string;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    const started = Date.now();
    const binary = await ctx.fns.pdf.litBin({});
    const empty = { ok: false, input, binary, needsOcr: false, verdict: "unknown" as const, pageCount: 0, pagesNeedingOcr: [], complexLayoutPages: [], reasons: [], textCoverage: 0, durationMs: Date.now() - started, pages: [] };
    if (!binary) return { ...empty, error: "LiteParse CLI 'lit' was not found; install it with 'uv tool install liteparse'." };
    if (!(await fs.access(input).then(() => true, () => false))) return { ...empty, binary, error: `Input file not found: ${input}` };
    const args = [binary, "is-complex", input, "--compact"];
    if (opts.targetPages) args.push("--target-pages", opts.targetPages); else if (opts.maxPages) args.push("--max-pages", String(opts.maxPages));
    if (opts.password) args.push("--password", opts.password);
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: process.env });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const durationMs = Date.now() - started;
    let raw: any[] = [];
    try { raw = JSON.parse(stdout.trim() || "[]"); } catch { raw = []; }
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ...empty, binary, durationMs, error: stderr.trim().split("\n").filter((l) => !l.startsWith("[liteparse]")).join(" ") || `lit is-complex exited with code ${code}` };
    }
    const pages = raw.map((p: any, index: number) => ({
        page: Number(p.page_number ?? index + 1),
        needsOcr: Boolean(p.needs_ocr),
        reasons: Array.isArray(p.reasons) ? p.reasons.map(String) : [],
        textLength: Number(p.text_length ?? 0),
        textCoverage: Number(p.text_coverage ?? 0),
        complexLayout: Boolean(p.layout?.is_complex),
        columns: Number(p.layout?.column_count ?? 0),
        tables: Number(p.layout?.ruled_table_count ?? 0) + Number(p.layout?.text_table_run_count ?? 0),
        figures: Number(p.layout?.figure_count ?? 0),
    }));
    const pagesNeedingOcr = pages.filter((p) => p.needsOcr).map((p) => p.page);
    const reasons = [...new Set(pages.flatMap((p) => p.reasons))];
    const textCoverage = Number((pages.reduce((sum, p) => sum + p.textCoverage, 0) / pages.length).toFixed(4));
    return {
        ok: true,
        input,
        binary,
        needsOcr: pagesNeedingOcr.length > 0,
        verdict: pagesNeedingOcr.length > 0 ? "COMPLEX" : "SIMPLE",
        pageCount: pages.length,
        pagesNeedingOcr,
        complexLayoutPages: pages.filter((p) => p.complexLayout).map((p) => p.page),
        reasons,
        textCoverage,
        durationMs,
        pages,
    };
}
