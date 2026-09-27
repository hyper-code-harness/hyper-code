import { homedir } from "node:os";

/**
 * Lists locally downloaded whisper.cpp ggml models usable by whisper.transcribe.
 * Use to pick a model name before transcribing or to populate a model selector.
 */
export default async function (_ctx: Context, _session: Session | null, _opts: {}): Promise<{ dir: string; models: { name: string; sizeMb: number }[] }> {
    const dir = `${homedir()}/.local/share/whisper-cpp`;
    const models: { name: string; sizeMb: number }[] = [];
    for await (const f of new Bun.Glob("ggml-*.bin").scan({ cwd: dir })) {
        models.push({ name: f.slice(5, -4), sizeMb: Math.round(Bun.file(`${dir}/${f}`).size / 1048576) });
    }
    models.sort((a, b) => b.sizeMb - a.sizeMb);
    return { dir, models };
}
