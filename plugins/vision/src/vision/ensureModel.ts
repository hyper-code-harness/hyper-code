/**
 * Ensures the LM Studio vision model for the qwen OCR engine is running, starting the server and loading the model if needed.
 *
 * Idempotent readiness check for vision.qwenOcr: queries LM Studio's /api/v0/models, starts the local server with `lms server start` if it is down (localhost URLs only), and loads the configured model (setting vision.qwenModel) with `lms load` when it is not loaded. Loading takes ~5-15 s and ~10 GB RAM; a TTL auto-unloads the model after idle time so memory is returned. Fails with an install hint if the model is not downloaded. Called automatically by vision.qwenOcr; call directly to pre-warm before a batch.
 * @param opts.model LM Studio model identifier; overrides the vision.qwenModel setting.
 * @param opts.contextLength Context window to load with; one image plus a dense page transcription fits in 16k. @default 16384 @minimum 4096 @maximum 262144
 * @param opts.ttlSeconds Idle seconds before LM Studio auto-unloads the model; 0 keeps it loaded until unloaded manually. @default 3600 @minimum 0 @maximum 604800
 * @param opts.timeoutSeconds Kill `lms load` after this many seconds. @default 300 @minimum 10 @maximum 3600
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** LM Studio model identifier; overrides the vision.qwenModel setting. */
        model?: string;
        /** Context window to load with; one image plus a dense page transcription fits in 16k. @default 16384 @minimum 4096 @maximum 262144 */
        contextLength?: number;
        /** Idle seconds before LM Studio auto-unloads the model; 0 keeps it loaded until unloaded manually. @default 3600 @minimum 0 @maximum 604800 */
        ttlSeconds?: number;
        /** Kill `lms load` after this many seconds. @default 300 @minimum 10 @maximum 3600 */
        timeoutSeconds?: number;
    },
): Promise<{ model: string; state: "already-loaded" | "loaded"; serverStarted: boolean; durationMs: number }> {
    const baseUrl = ((await ctx.fns.settings.getString({ module: "vision", key: "lmstudioUrl", scopeType: "global", fallback: "http://localhost:1234/v1" })) ?? "http://localhost:1234/v1").replace(/\/$/, "");
    const model = opts.model ?? (await ctx.fns.settings.getString({ module: "vision", key: "qwenModel", scopeType: "global", fallback: "qwen3-vl-8b-instruct" })) ?? "qwen3-vl-8b-instruct";
    const home = process.env.HOME ?? "";
    const lms = (await Bun.file(`${home}/.lmstudio/bin/lms`).exists()) ? `${home}/.lmstudio/bin/lms` : "lms";
    const apiRoot = baseUrl.replace(/\/v1$/, "");
    type Info = { id: string; type?: string; state?: string };
    const list = async (): Promise<Info[] | null> => {
      try { const r = await fetch(`${apiRoot}/api/v0/models`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) return null; return ((await r.json()) as { data?: Info[] }).data ?? []; }
      catch { return null; }
    };
    const started = performance.now();
    let serverStarted = false;
    let models = await list();
    if (!models) {
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiRoot);
      if (!isLocal) throw new Error(`vision.ensureModel: LM Studio unreachable at ${apiRoot}`);
      const s = await Bun.$`${lms} server start`.quiet().nothrow();
      if (s.exitCode !== 0) throw new Error(`vision.ensureModel: cannot start LM Studio server: ${s.stderr.toString().trim()}`);
      serverStarted = true;
      for (let i = 0; i < 30 && !models; i++) { await Bun.sleep(1000); models = await list(); }
      if (!models) throw new Error(`vision.ensureModel: LM Studio server did not come up at ${apiRoot}`);
    }
    const info = models.find(m => m.id === model);
    if (!info) throw new Error(`vision.ensureModel: model ${model} is not downloaded in LM Studio; run: lms get https://huggingface.co/mlx-community/Qwen3-VL-8B-Instruct-8bit -y`);
    if (info.type && info.type !== "vlm") throw new Error(`vision.ensureModel: ${model} is type ${info.type}, not a vision model`);
    if (info.state === "loaded") return { model, state: "already-loaded" as const, serverStarted, durationMs: Math.round(performance.now() - started) };
    const ctxLen = opts.contextLength ?? 16384;
    const ttl = opts.ttlSeconds ?? 3600;
    const args = [lms, "load", model, "--identifier", model, "--context-length", String(ctxLen), "-y", ...(ttl > 0 ? ["--ttl", String(ttl)] : [])];
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), (opts.timeoutSeconds ?? 300) * 1000);
    const code = await p.exited; clearTimeout(timer);
    if (code !== 0) throw new Error(`vision.ensureModel: lms load ${model} failed (${code}): ${(await new Response(p.stderr).text()).trim().slice(0, 400)}`);
    const after = (await list())?.find(m => m.id === model);
    if (after?.state !== "loaded") throw new Error(`vision.ensureModel: ${model} still not loaded after lms load`);
    return { model, state: "loaded" as const, serverStarted, durationMs: Math.round(performance.now() - started) };
}
