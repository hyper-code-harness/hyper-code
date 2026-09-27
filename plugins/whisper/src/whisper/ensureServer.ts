import { homedir, tmpdir } from "node:os";

/**
 * Ensures a resident whisper.cpp HTTP server (whisper-server, Metal) is running for a model and returns its URL.
 * Keeping the model loaded removes the ~1 s load cost per request, which is required for live streaming transcription.
 * Use before sending many short requests, e.g. from the /whisper/live page.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Model name from whisper.models. @default "large-v3-turbo" */
    model?: string;
}): Promise<{ model: string; url: string; port: number; started: boolean }> {
    const model = opts.model ?? "large-v3-turbo";
    if (!/^[\w.-]+$/.test(model)) throw new Error(`bad model name: ${model}`);
    const modelPath = `${homedir()}/.local/share/whisper-cpp/ggml-${model}.bin`;
    if (!(await Bun.file(modelPath).exists())) throw new Error(`model not found: ${modelPath}`);
    const port = 8800 + (Number(Bun.hash(model)) % 100);
    const url = `http://127.0.0.1:${port}`;
    const up = async () => { try { return (await fetch(url, { signal: AbortSignal.timeout(500) })).status < 500; } catch { return false; } };
    if (await up()) return { model, url, port, started: false };
    const log = Bun.file(`${tmpdir()}/whisper-server-${model}.log`);
    const p = Bun.spawn(["whisper-server", "-m", modelPath, "--host", "127.0.0.1", "--port", String(port), "-nt", "-t", "8"], { stdout: log, stderr: log, stdin: "ignore" });
    p.unref();
    for (let i = 0; i < 120; i++) { await Bun.sleep(250); if (await up()) return { model, url, port, started: true }; if (p.exitCode !== null) break; }
    throw new Error(`whisper-server failed to start, see ${tmpdir()}/whisper-server-${model}.log`);
}
