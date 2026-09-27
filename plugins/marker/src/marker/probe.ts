/** Inspects a local PDF page by page before conversion and recommends a Marker route.
 * Use to distinguish born-digital, mixed, sparse-text, and scanned documents without
 * changing the source. The report includes SHA-256 provenance and per-page text density.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Absolute path to the source PDF. */
        input: string;
        /** Text characters per page below which a page is treated as scanned. @default 40 @minimum 0 @maximum 2000 */
        scannedThreshold?: number;
        /** Text characters per page below which a page is treated as sparse. @default 300 @minimum 1 @maximum 5000 */
        sparseThreshold?: number;
    },
): Promise<{
    input: string;
    sha256: string;
    bytes: number;
    pages: number;
    pageTextCharacters: number[];
    scannedPages: number[];
    sparsePages: number[];
    digitalPages: number[];
    classification: "digital" | "mixed" | "sparse" | "scanned";
    recommendedMode: "fast" | "balanced" | "ocr";
    recommendedDevice: "mps" | "cpu";
    reason: string;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    if (path.extname(input).toLowerCase() !== ".pdf") throw new Error("marker.probe: input must be a PDF file");
    const file = Bun.file(input);
    if (!(await file.exists())) throw new Error(`marker.probe: input not found: ${input}`);
    const scannedThreshold = Math.max(0, Math.min(2000, opts.scannedThreshold ?? 40));
    const sparseThreshold = Math.max(scannedThreshold + 1, Math.min(5000, opts.sparseThreshold ?? 300));
    const digest = new Bun.CryptoHasher("sha256");
    digest.update(await file.arrayBuffer());
    const sha256 = digest.digest("hex");
    const info = Bun.spawn(["pdfinfo", input], { stdout: "pipe", stderr: "pipe" });
    const [infoOut, infoErr, infoCode] = await Promise.all([new Response(info.stdout).text(), new Response(info.stderr).text(), info.exited]);
    if (infoCode !== 0) throw new Error(`marker.probe: pdfinfo failed: ${infoErr.slice(-1000)}`);
    const pageMatch = infoOut.match(/^Pages:\s+(\d+)/m);
    if (!pageMatch) throw new Error("marker.probe: could not determine PDF page count");
    const pages = Number(pageMatch[1]);
    const tempRoot = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "marker-probe-"));
    try {
        const counts: number[] = [];
        for (let page = 1; page <= pages; page++) {
            const out = path.join(tempRoot, `${page}.txt`);
            const proc = Bun.spawn(["pdftotext", "-enc", "UTF-8", "-f", String(page), "-l", String(page), input, out], { stdout: "pipe", stderr: "pipe" });
            await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
            const text = await Bun.file(out).text().catch(() => "");
            counts.push(text.replace(/\s/g, "").length);
        }
        const scannedPages = counts.flatMap((count, index) => count < scannedThreshold ? [index] : []);
        const sparsePages = counts.flatMap((count, index) => count >= scannedThreshold && count < sparseThreshold ? [index] : []);
        const digitalPages = counts.flatMap((count, index) => count >= sparseThreshold ? [index] : []);
        let classification: "digital" | "mixed" | "sparse" | "scanned";
        if (scannedPages.length === pages) classification = "scanned";
        else if (digitalPages.length === pages) classification = "digital";
        else if (scannedPages.length || (digitalPages.length && sparsePages.length)) classification = "mixed";
        else classification = "sparse";
        const recommendedMode = classification === "digital" ? "fast" : classification === "scanned" ? "ocr" : "balanced";
        const recommendedDevice = classification === "scanned" && pages >= 4 ? "cpu" : "mps";
        const reason = classification === "digital"
            ? "Every page has a substantial embedded text layer; disabling OCR avoids recognition errors and startup cost."
            : classification === "scanned"
                ? "Every page lacks usable embedded text; forced OCR is required and CPU avoids late Surya MPS retries on long scans."
                : `The PDF contains ${scannedPages.length} scanned and ${sparsePages.length} sparse page(s); normal Marker detection should preserve digital text while OCRing weak pages.`;
        return { input, sha256, bytes: file.size, pages, pageTextCharacters: counts, scannedPages, sparsePages, digitalPages, classification, recommendedMode, recommendedDevice, reason };
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
