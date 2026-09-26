/**
 * Transcribes an image to Markdown with a local Qwen3-VL model served by LM Studio.
 *
 * Accurate local OCR engine: sends the image to an OpenAI-compatible LM Studio server (setting vision.lmstudioUrl, model vision.qwenModel, default qwen3-vl-8b-instruct 8-bit MLX) and returns Markdown with tables. Tradeoffs from a 7-image bench on M3 Ultra: best accuracy of the tested engines on Russian text, invoices, receipts, handwriting and tables (beat GLM-OCR, PaddleOCR-VL 1.6, MinerU 4 and matched Chandra 2), but ~5-30 s per image (≈55-60 tokens/s, time grows with the amount of text), no line boxes or confidence, needs LM Studio with the model downloaded (auto-started and auto-loaded via vision.ensureModel, ~10 GB RAM, unloaded after 1 h idle), and as a generative model it can silently hallucinate or loop on dense pages — check truncated and verify money amounts. HEIC/TIFF must be converted to JPEG/PNG first. Prefer vision.ocr with engine qwen.
 * @param opts.path Absolute or server-relative path to a PNG, JPEG, WebP or GIF image.
 * @param opts.prompt Override the transcription instruction, e.g. to extract specific fields as JSON. Defaults to verbatim Markdown transcription.
 * @param opts.model LM Studio model identifier; overrides the vision.qwenModel setting.
 * @param opts.maxTokens Upper bound on generated tokens; dense spreadsheets need ~2000. @default 6000 @minimum 64 @maximum 32000
 * @param opts.timeoutSeconds Abort the LM Studio request after this many seconds. @default 300 @minimum 10 @maximum 3600
 * @param opts.ensure Call vision.ensureModel first so LM Studio's server is started and the model loaded on demand (first call pays ~5-15 s load). @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute or server-relative path to a PNG, JPEG, WebP or GIF image. */
        path: string;
        /** Override the transcription instruction, e.g. to extract specific fields as JSON. Defaults to verbatim Markdown transcription. */
        prompt?: string;
        /** LM Studio model identifier; overrides the vision.qwenModel setting. */
        model?: string;
        /** Upper bound on generated tokens; dense spreadsheets need ~2000. @default 6000 @minimum 64 @maximum 32000 */
        maxTokens?: number;
        /** Abort the LM Studio request after this many seconds. @default 300 @minimum 10 @maximum 3600 */
        timeoutSeconds?: number;
        /** Call vision.ensureModel first so LM Studio's server is started and the model loaded on demand (first call pays ~5-15 s load). @default true */
        ensure?: boolean;
    },
): Promise<{ engine: "qwen"; model: string; path: string; durationMs: number; text: string; outputTokens: number; truncated: boolean; loadedModel: boolean }> {
    const path = await import("node:path");
    const input = path.resolve(opts.path);
    const file = Bun.file(input);
    if (!(await file.exists())) throw new Error(`vision.qwenOcr: image not found: ${input}`);
    const baseUrl = (await ctx.fns.settings.getString({ module: "vision", key: "lmstudioUrl", scopeType: "global", fallback: "http://localhost:1234/v1" })) ?? "http://localhost:1234/v1";
    const model = opts.model ?? (await ctx.fns.settings.getString({ module: "vision", key: "qwenModel", scopeType: "global", fallback: "qwen3-vl-8b-instruct" })) ?? "qwen3-vl-8b-instruct";
    const ensured = opts.ensure === false ? null : await ctx.fns.vision.ensureModel({ model });
    const ext = path.extname(input).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    if (ext === ".heic" || ext === ".heif" || ext === ".tif" || ext === ".tiff") throw new Error("vision.qwenOcr: convert HEIC/TIFF to JPEG or PNG first (e.g. sips -s format jpeg)");
    const prompt = opts.prompt ?? "Transcribe all text in this image exactly as written, preserving the original language. Output Markdown; render tables as Markdown tables. Do not translate, summarize or add commentary.";
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const started = performance.now();
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout((opts.timeoutSeconds ?? 300) * 1000),
      body: JSON.stringify({ model, temperature: 0, max_tokens: opts.maxTokens ?? 6000, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }] }),
    }).catch((e: Error) => { throw new Error(`vision.qwenOcr: LM Studio unreachable at ${baseUrl} (${e.message}); start it and load ${model}: lms load ${model}`); });
    const json = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: unknown };
    if (!res.ok || !json.choices?.length) throw new Error(`vision.qwenOcr: LM Studio error ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
    let text = json.choices[0]?.message?.content ?? "";
    const fenced = text.trim().match(/^\`\`\`(?:markdown|md)?\n([\s\S]*?)\n?\`\`\`$/);
    if (fenced?.[1] !== undefined) text = fenced[1];
    return { engine: "qwen" as const, model, path: input, durationMs: Math.round(performance.now() - started), text: text.trim(), outputTokens: json.usage?.completion_tokens ?? 0, truncated: json.choices[0]?.finish_reason === "length", loadedModel: ensured?.state === "loaded" };
}
