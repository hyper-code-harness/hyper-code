// Text → audio file via Google Cloud TTS. Long texts are chunked by sentence
// (~4500 bytes) and concatenated with ffmpeg. Markdown is stripped by default.
// ctx.fns.tts.speak({ text: "Привет", out: "/tmp/hi.ogg" })
// → { saved, seconds?, chunks }
/**
 * Resolves and caches a Google OAuth access token for text-to-speech calls.
 *
 * @param ctx - Runtime context used to resolve stored OAuth credentials.
 * @returns A valid bearer access token.
 */
async function accessToken(ctx: Context) {
    const cache = ((ctx.state as any).tts ??= {} as { token?: { access_token: string; expires_at: number } });
    if (cache.token && Date.now() < cache.token.expires_at - 60_000) return cache.token.access_token;
    const [tokenRaw, clientRaw] = await Promise.all([
        ctx.fns.secrets.get({ ref: "op://hyper/tts token.json/value", namespace: "tts", name: "token" }),
        ctx.fns.secrets.get({ ref: "op://hyper/tts client_secret.json/value", namespace: "tts", name: "client" }),
    ]);
    if (!tokenRaw || !clientRaw) throw new Error("Google Cloud TTS credentials are not configured");
    const token = JSON.parse(tokenRaw), secret = JSON.parse(clientRaw), creds = secret.installed || secret.web;
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.access_token) throw new Error(`TTS token refresh failed (${res.status})`);
    cache.token = { access_token: json.access_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return cache.token.access_token;
}

/**
 * Synthesizes text to an audio file, routed to the configured speech engine.
 *
 * By default this calls the Gemini TTS models, which give expressive delivery, accept a
 * plain-prose style instruction and render long text in one pass. Set engine: "google"
 * (or change the tts.engine setting) to use classic Google Cloud Chirp voices instead,
 * where long text is chunked by sentence and concatenated with ffmpeg. Use tts.gemini
 * directly for multi-speaker dialogue.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Text to synthesize. */
        text: string;
        /** Destination audio file path. */
        out?: string;                 // default /tmp/tts-<ts>.ogg

        /** Speech backend. Defaults to the tts.engine setting, normally gemini. */
        engine?: "gemini" | "google";

        /** Delivery instruction for the gemini engine, such as "Say warmly". */
        style?: string;

        /** Gemini TTS model id used when engine is gemini. */
        model?: "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts";

        /** Voice name. Gemini prebuilt voice such as Kore, or a Google Cloud voice name. */
        voice?: string;               // default Chirp3-HD-Puck of the lang

        /** BCP 47 language code. Applies to the google engine. */
        lang?: string;                // default ru-RU

        /** Speaking-rate multiplier from 0.25 to 4.0. Applies to the google engine. */
        speed?: number;               // 0.25–4.0

        /** Voice pitch in semitones from -20 to 20. Applies to the google engine. */
        pitch?: number;               // -20…20 semitones

        /** Audio encoding format. Applies to the google engine. */
        format?: "OGG_OPUS" | "MP3" | "LINEAR16";
        /** Whether to strip Markdown before synthesis. */
        strip?: boolean;              // strip markdown (default true)
}): Promise<{
    /** Path of the written audio file. */
    saved: string;
    /** Number of synthesis requests concatenated into the file. */
    chunks: number;
    /** Backend that produced the audio. */
    engine: "gemini" | "google";
    /** Audio duration in seconds when the engine reports it. */
    seconds: number | null;
    /** Estimated cost in US cents when the engine reports token usage. */
    cents: number | null;
    /** Model or voice identifier that produced the audio. */
    model: string;
}> {
    if (!opts?.text?.trim()) throw new Error("tts.speak: text is required");

    const engine = opts.engine
        ?? await ctx.fns.settings.getString({ module: "tts", scopeType: "global", key: "engine", fallback: "gemini" });

    if (engine === "gemini") {
        const res = await ctx.fns.tts.gemini({
            text: opts.text,
            ...(opts.out ? { out: opts.out } : {}),
            ...(opts.voice ? { voice: opts.voice } : {}),
            ...(opts.style ? { style: opts.style } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            ...(opts.strip === undefined ? {} : { strip: opts.strip }),
        });
        return { saved: res.saved, chunks: 1, engine: "gemini", seconds: res.seconds, cents: res.cents, model: res.model };
    }

    const access_token = await accessToken(ctx);
    const lang = opts.lang ?? "ru-RU";
    const voice = opts.voice ?? (lang.startsWith("en") ? "en-US-Chirp3-HD-Puck" : "ru-RU-Chirp3-HD-Puck");
    const format = opts.format ?? "OGG_OPUS";
    const ext = format === "MP3" ? "mp3" : format === "LINEAR16" ? "wav" : "ogg";
    const out = opts.out ?? `/tmp/tts-${Date.now()}.${ext}`;

    let text = opts.text;
    if (opts.strip !== false) {
        text = text
            .replace(/```[\s\S]*?```/g, "")
            .replace(/\|[^\n]+\|/g, "")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[*_~`]/g, "")
            .replace(/^[-*]\s+/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // chunk by sentences, max ~4500 bytes
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    const chunks: string[] = [];
    if (bytes(text) <= 4500) chunks.push(text);
    else {
        let cur = "";
        for (const s of text.split(/(?<=[.!?。\n])\s*/)) {
            const combined = cur ? cur + " " + s : s;
            if (bytes(combined) > 4500) { if (cur) chunks.push(cur); cur = s; }
            else cur = combined;
        }
        if (cur) chunks.push(cur);
    }

    const synth = async (t: string): Promise<Buffer> => {
        const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
            method: "POST",
            headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                input: t.startsWith("<speak>") ? { ssml: t } : { text: t },
                voice: { languageCode: lang, name: voice },
                audioConfig: {
                    audioEncoding: format,
                    ...(opts.speed ? { speakingRate: opts.speed } : {}),
                    ...(opts.pitch ? { pitch: opts.pitch } : {}),
                },
            }),
        });
        const json: any = await res.json();
        if (!res.ok || !json.audioContent) throw new Error(`TTS API error (${res.status}): ${JSON.stringify(json)}`);
        return Buffer.from(json.audioContent, "base64");
    };

    if (chunks.length === 1) {
        await Bun.write(out, await synth(chunks[0]!));
        return { saved: out, chunks: 1, engine: "google" as const, seconds: null, cents: null, model: voice };
    }

    // multi-chunk: synth in parallel, concat with ffmpeg
    const buffers = await Promise.all(chunks.map(synth));
    const tmpBase = `/tmp/tts-chunks-${Date.now()}`;
    const files: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
        const f = `${tmpBase}-${i}.${ext}`;
        await Bun.write(f, buffers[i]!);
        files.push(f);
    }
    const listFile = `${tmpBase}-list.txt`;
    await Bun.write(listFile, files.map(f => `file '${f}'`).join("\n"));
    const proc = Bun.spawn(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out], { stdout: "ignore", stderr: "pipe" });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    for (const f of [...files, listFile]) await Bun.file(f).unlink().catch(() => {});
    if (code !== 0) throw new Error(`ffmpeg concat failed (${code}): ${stderr.slice(-500)}`);
    return { saved: out, chunks: chunks.length, engine: "google" as const, seconds: null, cents: null, model: voice };
}
