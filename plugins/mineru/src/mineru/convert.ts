/** Converts one local PDF to Markdown with MinerU and returns all generated artifacts plus a comparable quality report.
 * Use `vlm-engine` for Apple Silicon MLX inference or `pipeline` for explicit text/OCR routing.
 * The function never modifies the source and writes a SHA-256 provenance manifest.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path to the source PDF. */ input: string;
    /** Output directory. Defaults to ~/Documents/mineru-output/<name>-<timestamp>. */ outputDir?: string;
    /** MinerU local backend. @default "vlm-engine" */ backend?: "vlm-engine" | "pipeline" | "hybrid-engine";
    /** Pipeline parsing method; only passed for the pipeline backend. @default "auto" */ method?: "auto" | "txt" | "ocr";
    /** Hybrid effort level; only passed for hybrid-engine. @default "medium" */ effort?: "medium" | "high";
    /** OCR language for pipeline mode, such as cyrillic or east_slavic. */ language?: "ch" | "korean" | "ta" | "te" | "ka" | "th" | "el" | "arabic" | "east_slavic" | "cyrillic" | "devanagari";
    /** Zero-based first page. @minimum 0 */ startPage?: number;
    /** Zero-based final page, inclusive. @minimum 0 */ endPage?: number;
    /** Abort after this many seconds. @default 1800 @minimum 30 @maximum 14400 */ timeoutSeconds?: number;
}): Promise<{
    ok: true; input: string; sourceSha256: string; outputDir: string; markdownPath: string; manifestPath: string;
    backend: "vlm-engine" | "pipeline" | "hybrid-engine"; durationMs: number; exitCode: number;
    artifacts: Array<{ path: string; relativePath: string; bytes: number; kind: "markdown" | "image" | "json" | "pdf" | "other" }>;
    analysis: Awaited<ReturnType<typeof ctx.fns.marker.analyze>>; stdoutTail: string; stderrTail: string;
}> {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const input = path.resolve(opts.input);
    if (path.extname(input).toLowerCase() !== ".pdf") throw new Error("mineru.convert: input must be a PDF file");
    const source = Bun.file(input);
    if (!(await source.exists())) throw new Error(`mineru.convert: input not found: ${input}`);
    const status = await ctx.fns.mineru.status({});
    if (!status.installed || !status.executable) throw new Error("mineru.convert: MinerU is not installed; run `uv tool install --python 3.11 'mineru[all]'`");
    const hasher = new Bun.CryptoHasher("sha256"); hasher.update(await source.arrayBuffer()); const sourceSha256 = hasher.digest("hex");
    const backend = opts.backend ?? "vlm-engine";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stem = path.basename(input, ".pdf").normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "document";
    const outputDir = path.resolve(opts.outputDir ?? path.join(process.env.HOME ?? ".", "Documents", "mineru-output", `${stem}-${timestamp}`));
    await fs.mkdir(outputDir, { recursive: true });
    const args = [status.executable, "-p", input, "-o", outputDir, "-b", backend];
    if (backend === "pipeline") args.push("-m", opts.method ?? "auto");
    if (backend === "hybrid-engine") args.push("--effort", opts.effort ?? "medium");
    if (backend === "pipeline" && opts.language) args.push("-l", opts.language);
    if (opts.startPage !== undefined) args.push("-s", String(Math.max(0, opts.startPage)));
    if (opts.endPage !== undefined) args.push("-e", String(Math.max(0, opts.endPage)));
    const startedAt = new Date();
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: process.env });
    const timeoutSeconds = Math.max(30, Math.min(14400, opts.timeoutSeconds ?? 1800));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutSeconds * 1000);
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).finally(() => clearTimeout(timer));
    const durationMs = Date.now() - startedAt.getTime();
    if (timedOut) throw new Error(`mineru.convert: timed out after ${timeoutSeconds}s; partial output: ${outputDir}`);
    if (exitCode !== 0) throw new Error(`mineru.convert failed (${exitCode}): ${(stderr || stdout).slice(-4000)}; partial output: ${outputDir}`);
    const discovered: string[] = [];
    const walk = async (dir: string) => { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else discovered.push(file); } };
    await walk(outputDir);
    const markdownFiles = discovered.filter((file) => path.extname(file).toLowerCase() === ".md").sort((a, b) => Bun.file(b).size - Bun.file(a).size);
    const markdownPath = markdownFiles[0];
    if (!markdownPath) throw new Error(`mineru.convert: no Markdown generated under ${outputDir}`);
    const analysis = await ctx.fns.marker.analyze({ markdownPath, sourcePdf: input });
    const kindFor = (file: string): "markdown" | "image" | "json" | "pdf" | "other" => { const ext = path.extname(file).toLowerCase(); if (ext === ".md") return "markdown"; if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "image"; if (ext === ".json") return "json"; if (ext === ".pdf") return "pdf"; return "other"; };
    const artifacts = discovered.map((file) => ({ path: file, relativePath: path.relative(outputDir, file), bytes: Bun.file(file).size, kind: kindFor(file) }));
    const manifestPath = path.join(outputDir, "mineru-run.json");
    await Bun.write(manifestPath, JSON.stringify({ plugin: "mineru", version: status.version, input, sourceSha256, outputDir, markdownPath, backend, options: { method: opts.method ?? null, effort: opts.effort ?? null, language: opts.language ?? null, startPage: opts.startPage ?? null, endPage: opts.endPage ?? null }, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), durationMs, exitCode, command: args.map((value, index) => index === 0 ? path.basename(value) : value), artifacts, analysis, stdoutTail: stdout.slice(-8000), stderrTail: stderr.slice(-8000) }, null, 2));
    artifacts.push({ path: manifestPath, relativePath: "mineru-run.json", bytes: Bun.file(manifestPath).size, kind: "json" });
    return { ok: true, input, sourceSha256, outputDir, markdownPath, manifestPath, backend, durationMs, exitCode, artifacts, analysis, stdoutTail: stdout.slice(-4000), stderrTail: stderr.slice(-4000) };
}
