/** Converts one local PDF to Markdown with Marker and returns generated artifacts plus a quality report.
 * Use for private local PDF extraction on this Mac. The function records a reproducible manifest,
 * captures bounded CLI output, discovers Marker output files, and automatically calls marker.analyze.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Absolute path to the source PDF. */
        input: string;
        /** Output directory. Defaults to ~/Documents/marker-output/<name>-<timestamp>. */
        outputDir?: string;
        /** Conversion strategy. Auto probes every page and selects fast, balanced, or forced OCR. @default "auto" */
        mode?: "auto" | "balanced" | "fast" | "ocr";
        /** Optional Marker page range such as "0-4,8,11". Marker uses zero-based page indexes. */
        pageRange?: string;
        /** Include image extraction and references in Markdown. @default true */
        extractImages?: boolean;
        /** Insert page separators in the generated output. @default true */
        paginate?: boolean;
        /** Enable Marker's configured LLM enhancement. This can invoke a local or external model. @default false */
        useLlm?: boolean;
        /** Processing device. Auto tries Apple MPS first and retries on CPU if Marker/Surya hits a Metal accelerator error. @default "auto" */
        device?: "auto" | "mps" | "cpu";
        /** Abort each Marker attempt after this many seconds. @default 1800 @minimum 30 @maximum 14400 */
        timeoutSeconds?: number;
    },
): Promise<{
    ok: true;
    input: string;
    outputDir: string;
    markdownPath: string;
    manifestPath: string;
    requestedMode: "auto" | "balanced" | "fast" | "ocr";
    mode: "balanced" | "fast" | "ocr";
    probe: Awaited<ReturnType<typeof ctx.fns.marker.probe>>;
    durationMs: number;
    exitCode: number;
    device: "mps" | "cpu";
    fallbackReason?: string;
    artifacts: Array<{ path: string; relativePath: string; bytes: number; kind: "markdown" | "image" | "json" | "html" | "other" }>;
    analysis: Awaited<ReturnType<typeof ctx.fns.marker.analyze>>;
    stdoutTail: string;
    stderrTail: string;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    if (path.extname(input).toLowerCase() !== ".pdf") throw new Error("marker.convert: input must be a PDF file");
    if (!(await Bun.file(input).exists())) throw new Error(`marker.convert: input not found: ${input}`);
    const status = await ctx.fns.marker.status({});
    if (!status.installed || !status.executable) throw new Error("marker.convert: marker-pdf is not installed; install it with `uv pip install marker-pdf`");
    const probe = await ctx.fns.marker.probe({ input });
    const requestedMode = opts.mode ?? "auto";
    const mode: "balanced" | "fast" | "ocr" = requestedMode === "auto" ? probe.recommendedMode : requestedMode;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeStem = path.basename(input, path.extname(input)).normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "document";
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "marker-output", `${safeStem}-${timestamp}`));
    await fs.mkdir(outputDir, { recursive: true });
    const args = [status.executable, input, "--output_dir", outputDir, "--output_format", "markdown", "--disable_tqdm"];
    if (mode === "fast") args.push("--disable_ocr");
    if (mode === "ocr") args.push("--force_ocr");
    if (opts.pageRange) {
        if (!/^[0-9,\-\s]+$/.test(opts.pageRange)) throw new Error("marker.convert: invalid pageRange; use digits, commas, spaces, and hyphens only");
        args.push("--page_range", opts.pageRange);
    }
    if (opts.extractImages === false) args.push("--disable_image_extraction");
    if (opts.paginate !== false) args.push("--paginate_output");
    if (opts.useLlm) args.push("--use_llm");
    const startedAt = new Date();
    const timeoutSeconds = Math.max(30, Math.min(14400, opts.timeoutSeconds ?? 1800));
    const requestedDevice = opts.device ?? "auto";
    const attempts: Array<{ device: "mps" | "cpu"; stdout: string; stderr: string; exitCode: number; timedOut: boolean }> = [];
    const run = async (device: "mps" | "cpu") => {
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: { ...process.env, TORCH_DEVICE: device } });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutSeconds * 1000);
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]).finally(() => clearTimeout(timer));
        const attempt = { device, stdout, stderr, exitCode, timedOut };
        attempts.push(attempt);
        return attempt;
    };
    const firstDevice: "mps" | "cpu" = requestedDevice === "cpu" || (requestedDevice === "auto" && probe.recommendedDevice === "cpu") || !status.mpsAvailable ? "cpu" : "mps";
    let attempt = await run(firstDevice);
    let fallbackReason: string | undefined;
    const acceleratorFailure = /AcceleratorError|MPS backend|not implemented for.*MPS|out of bounds/i.test(attempt.stderr);
    if (requestedDevice === "auto" && firstDevice === "mps" && attempt.exitCode !== 0 && acceleratorFailure) {
        fallbackReason = `Marker/Surya failed on MPS and was retried on CPU: ${attempt.stderr.split("\n").slice(-2).join(" ").slice(0, 500)}`;
        attempt = await run("cpu");
    }
    const { stdout, stderr, exitCode, timedOut, device } = attempt;
    const durationMs = Date.now() - startedAt.getTime();
    if (timedOut) throw new Error(`marker.convert: timed out after ${timeoutSeconds}s on ${device}; partial output: ${outputDir}`);
    if (exitCode !== 0) throw new Error(`marker.convert failed (${exitCode}) on ${device}: ${(stderr || stdout).slice(-4000)}; partial output: ${outputDir}`);
    const discovered: string[] = [];
    const walk = async (dir: string) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else discovered.push(absolute);
        }
    };
    await walk(outputDir);
    const markdownFiles = discovered.filter((file) => path.extname(file).toLowerCase() === ".md" && path.basename(file) !== "marker-run.json");
    if (!markdownFiles.length) throw new Error(`marker.convert: Marker succeeded but no Markdown file was found under ${outputDir}`);
    markdownFiles.sort((a, b) => Bun.file(b).size - Bun.file(a).size);
    const markdownPath = markdownFiles[0]!;
    const analysis = await ctx.fns.marker.analyze({ markdownPath, sourcePdf: input });
    const kindFor = (file: string): "markdown" | "image" | "json" | "html" | "other" => {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".md") return "markdown";
        if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
        if (ext === ".json") return "json";
        if ([".html", ".htm"].includes(ext)) return "html";
        return "other";
    };
    const artifacts = discovered.map((file) => ({ path: file, relativePath: path.relative(outputDir, file), bytes: Bun.file(file).size, kind: kindFor(file) }));
    const manifestPath = path.join(outputDir, "marker-run.json");
    const manifest = {
        plugin: "marker", markerVersion: status.markerVersion, input, sourceSha256: probe.sha256, outputDir, markdownPath, requestedMode, mode, device, fallbackReason, probe,
        options: { pageRange: opts.pageRange ?? null, extractImages: opts.extractImages !== false, paginate: opts.paginate !== false, useLlm: Boolean(opts.useLlm), requestedDevice, timeoutSeconds },
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), durationMs, exitCode,
        command: args.map((arg, index) => index === 0 ? path.basename(arg) : arg), artifacts, analysis,
        attempts: attempts.map((item) => ({ device: item.device, exitCode: item.exitCode, timedOut: item.timedOut, stdoutTail: item.stdout.slice(-8000), stderrTail: item.stderr.slice(-8000) })),
        stdoutTail: stdout.slice(-8000), stderrTail: stderr.slice(-8000),
    };
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
    artifacts.push({ path: manifestPath, relativePath: path.basename(manifestPath), bytes: Bun.file(manifestPath).size, kind: "json" });
    return { ok: true, input, outputDir, markdownPath, manifestPath, requestedMode, mode, probe, device, ...(fallbackReason ? { fallbackReason } : {}), durationMs, exitCode, artifacts, analysis, stdoutTail: stdout.slice(-4000), stderrTail: stderr.slice(-4000) };
}
