import { homedir, tmpdir } from "node:os";

/**
 * Transcribes speech from a local audio file or raw audio bytes with whisper.cpp (Metal) and reports timings.
 * Any ffmpeg-readable input (wav, webm, ogg, mp3, m4a) is converted to 16 kHz mono WAV first.
 * Use for local voice input, dictation tests and comparing whisper models without any cloud service.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Absolute path of an audio file to transcribe; ignored when `audio` is given. */
    path?: string;
    /** Raw audio bytes (e.g. a browser MediaRecorder blob); takes precedence over `path`. */
    audio?: Uint8Array;
    /** Model name from whisper.models, without the ggml- prefix and .bin suffix. @default "large-v3-turbo" */
    model?: string;
    /** Spoken language code such as "ru" or "en", or "auto" to detect it. @default "auto" */
    language?: string;
    /** Initial prompt with vocabulary (names, identifiers, jargon) to bias recognition. */
    prompt?: string;
    /** Translate the speech to English instead of transcribing it. @default false */
    translate?: boolean;
}): Promise<{ text: string; model: string; language: string; audioSec: number; convertMs: number; whisperMs: number }> {
    const model = opts.model ?? "large-v3-turbo";
    if (!/^[\w.-]+$/.test(model)) throw new Error(`bad model name: ${model}`);
    const modelPath = `${homedir()}/.local/share/whisper-cpp/ggml-${model}.bin`;
    if (!(await Bun.file(modelPath).exists())) throw new Error(`model not found: ${modelPath}`);
    const language = opts.language ?? "auto";
    const id = Bun.randomUUIDv7();
    const tmpIn = `${tmpdir()}/whisper-in-${id}`, wav = `${tmpdir()}/whisper-${id}.wav`;
    let input = opts.path;
    try {
        if (opts.audio) { await Bun.write(tmpIn, opts.audio); input = tmpIn; }
        if (!input) throw new Error("path or audio is required");
        let t = performance.now();
        const ff = await Bun.$`ffmpeg -loglevel error -y -i ${input} -ar 16000 -ac 1 -c:a pcm_s16le ${wav}`.quiet().nothrow();
        if (ff.exitCode !== 0) throw new Error(`ffmpeg: ${ff.stderr.toString().trim()}`);
        const convertMs = Math.round(performance.now() - t);
        const audioSec = Math.round(((Bun.file(wav).size - 44) / 32000) * 10) / 10;
        const args = ["-m", modelPath, "-l", language, "-nt", "-np", "-f", wav];
        if (opts.prompt) args.push("--prompt", opts.prompt);
        if (opts.translate) args.push("-tr");
        t = performance.now();
        const r = await Bun.$`whisper-cli ${args}`.quiet().nothrow();
        const whisperMs = Math.round(performance.now() - t);
        if (r.exitCode !== 0) throw new Error(`whisper-cli: ${r.stderr.toString().trim().slice(-500)}`);
        const text = r.stdout.toString().trim().replace(/\s*\n\s*/g, " ");
        return { text, model, language, audioSec, convertMs, whisperMs };
    } finally {
        await Bun.$`rm -f ${tmpIn} ${wav}`.quiet().nothrow();
    }
}
