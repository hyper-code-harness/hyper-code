// Text → audio file via the Gemini TTS models (gemini-3.8-flash-tts and
// friends). Single narrator or a multi-speaker cast, with per-line style
// instructions expressed in the prompt text itself. The API returns raw PCM or
// WAV base64 in one response, so no chunking or ffmpeg concatenation is needed.
// ctx.fns.tts.gemini({ text: "Привет", out: "/tmp/hi.wav" })
// → { saved, bytes, mimeType, model, seconds, cents, usage }

/**
 * Resolves the Gemini API key from encrypted local secret storage.
 *
 * @param ctx - Runtime context used to resolve the stored key.
 * @returns The plain-text Gemini API key.
 */
async function apiKey(ctx: Context) {
    const key = await ctx.fns.secrets.get({ ref: "secret://tts/gemini_api_key", namespace: "tts", name: "gemini_api_key" });
    if (!key) throw new Error("tts.gemini: Gemini API key is not configured (secret://tts/gemini_api_key)");
    return key;
}

/**
 * Wraps raw signed 16-bit PCM audio in a minimal RIFF/WAVE container.
 *
 * @param pcm - Little-endian signed 16-bit PCM samples.
 * @param rate - Sample rate in hertz.
 * @param channels - Channel count.
 * @returns A complete WAV file buffer.
 */
function wav(pcm: Buffer, rate: number, channels: number) {
    const head = Buffer.alloc(44);
    const byteRate = rate * channels * 2;
    head.write("RIFF", 0);
    head.writeUInt32LE(36 + pcm.length, 4);
    head.write("WAVEfmt ", 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(channels, 22);
    head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(byteRate, 28);
    head.writeUInt16LE(channels * 2, 32);
    head.writeUInt16LE(16, 34);
    head.write("data", 36);
    head.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([head, pcm]);
}

/**
 * Synthesizes speech with a Gemini text-to-speech model, optionally as a multi-speaker dialogue.
 *
 * Use for expressive narration, for style-directed delivery written in plain prose
 * ("Say cheerfully:", "whisper conspiratorially:"), and for conversations where each
 * speaker needs a distinct prebuilt voice. Prefer tts.speak for plain Google Cloud
 * Chirp narration; prefer this function when style control or several voices matter.
 * Requires a Gemini API key in secret://tts/gemini_api_key.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Text to speak. Style directions may be written inline as prose. Ignored when lines is given. */
    text?: string;
    /** Multi-speaker dialogue lines rendered in order; each speaker must appear in cast. */
    lines?: Array<{
        /** Speaker name matching one cast entry. */
        speaker: string;
        /** Spoken content for this line. */
        text: string;
        /** Optional delivery style such as "excited and gossipy". */
        style?: string;
    }>;
    /** Speaker-to-voice assignment required when lines is given; at most two speakers. */
    cast?: Array<{
        /** Speaker name referenced by lines. */
        speaker: string;
        /** Prebuilt Gemini voice name such as Puck or Kore. */
        voice: string;
    }>;
    /** Destination audio file path. @default /tmp/tts-gemini-<ts>.wav */
    out?: string;
    /** Prebuilt Gemini voice for single-narrator synthesis. @default Kore */
    voice?: string;
    /** Gemini TTS model id. @default gemini-3.8-flash-tts */
    model?: "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts" | "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts";
    /** Optional global style instruction prepended to the prompt. */
    style?: string;
    /** Sampling temperature forwarded to the model. @minimum 0 @maximum 2 */
    temperature?: number;
    /** Strip Markdown formatting before synthesis. @default true */
    strip?: boolean;
}): Promise<{
    saved: string;
    bytes: number;
    mimeType: string;
    model: string;
    speakers: number;
    seconds: number | null;
    audioTokens: number | null;
    cents: number | null;
    usage: Record<string, unknown>;
}> {
    const model = opts.model ?? "gemini-3.8-flash-tts";
    const hasLines = Array.isArray(opts.lines) && opts.lines.length > 0;
    if (!hasLines && !opts.text?.trim()) throw new Error("tts.gemini: text or lines is required");

    const clean = (s: string) => opts.strip === false ? s : s
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_~`]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    let parts: Array<Record<string, unknown>>;
    let speechConfig: Record<string, unknown>;
    let speakers = 1;

    if (hasLines) {
        const cast = opts.cast ?? [];
        if (cast.length < 1) throw new Error("tts.gemini: cast is required when lines are given");
        const names = new Set(cast.map(c => c.speaker));
        for (const l of opts.lines!) if (!names.has(l.speaker)) throw new Error(`tts.gemini: line speaker "${l.speaker}" is not in cast`);
        speakers = cast.length;
        // Multi-speaker requests need one part per line, each tagged with its speaker.
        parts = opts.lines!.map((l, i) => ({
            text: (i === 0 && opts.style ? `${opts.style}. ` : "") + (l.style ? `(${l.style}) ` : "") + clean(l.text),
            speechMetadata: { speaker: l.speaker },
        }));
        speechConfig = {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: cast.map(c => ({ speaker: c.speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } })),
            },
        };
    } else {
        parts = [{ text: (opts.style ? `${opts.style}: ` : "") + clean(opts.text!) }];
        speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice ?? "Kore" } } };
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": await apiKey(ctx) },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig,
                ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
            },
        }),
    });
    const json: any = await res.json();
    const inline = json?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData)?.inlineData;
    if (!res.ok || !inline?.data) throw new Error(`tts.gemini: API error (${res.status}): ${JSON.stringify(json?.error ?? json).slice(0, 400)}`);

    const mimeType: string = inline.mimeType ?? "audio/wav";
    const raw = Buffer.from(inline.data, "base64");
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
    const isPcm = /L16|pcm/i.test(mimeType) && !/wav/i.test(mimeType);
    const audio = isPcm ? wav(raw, rate, 1) : raw;
    const ext = /mp3|mpeg/i.test(mimeType) ? "mp3" : /ogg|opus/i.test(mimeType) ? "ogg" : "wav";
    const out = opts.out ?? `/tmp/tts-gemini-${Date.now()}.${ext}`;
    await Bun.write(out, audio);

    const pcmBytes = isPcm ? raw.length : Math.max(0, raw.length - 44);
    const seconds = Math.round((pcmBytes / (rate * 2)) * 100) / 100;
    const audioTokens = json?.usageMetadata?.candidatesTokenCount ?? null;
    // Published Gemini Flash TTS audio-output pricing, US$ per million tokens.
    const perMillion = model.includes("lite") ? 6 : 12;
    const cents = audioTokens === null ? null : Math.round((audioTokens / 1_000_000) * perMillion * 100 * 1000) / 1000;

    return {
        saved: out,
        bytes: audio.length,
        mimeType,
        model,
        speakers,
        seconds: Number.isFinite(seconds) ? seconds : null,
        audioTokens,
        cents,
        usage: json?.usageMetadata ?? {},
    };
}
