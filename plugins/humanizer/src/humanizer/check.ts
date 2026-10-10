// Mechanical AI-tell sweep using the upstream check.py (no LLM, no network).
// ctx.fns.humanizer.check({ text: "…" }) → { findings, sentences, words }
import { resolve } from "node:path";

/**
 * Runs the upstream work-humanizer mechanical sweep over a text and lists its AI tells without calling any model.
 *
 * Use as the last step after rewriting, or alone to answer "why does this read like AI":
 * it counts em/en dashes, semicolons, stock AI vocabulary, marketing register, filler
 * transitions, pause-and-point and closer patterns, filler hedges, bold-label openings,
 * exclamation marks, and reports the sentence-length band and repeated sentence openers.
 * Deterministic and offline; requires python3 on PATH. Vocabulary is English, so a Russian
 * text yields mostly structural findings. Pass either text or a workspace-relative path.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Text to inspect. Mutually exclusive with `path`. */
    text?: string;
    /** Workspace-relative or absolute file to inspect instead of `text`. */
    path?: string;
}): Promise<{
    findings: string[];
    sentences: number | null;
    words: number | null;
    raw: string;
    source: "text" | "path";
}> {
    let text = opts.text;
    let source: "text" | "path" = "text";
    if (!text && opts.path) {
        text = await ctx.fns.files.read({ path: opts.path });
        source = "path";
    }
    if (!text?.trim()) throw new Error("humanizer.check: pass a non-empty `text` or an existing `path`");

    const script = resolve(import.meta.dir, "../../vendor/work-humanizer/check.py");
    const proc = Bun.spawn(["python3", script, "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(text);
    await proc.stdin.end();
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) throw new Error(`humanizer.check: check.py exited ${code}: ${err.trim().slice(0, 400)}`);

    const findings = out.split("\n").map(l => l.trim()).filter(Boolean);
    const sent = findings.find(l => l.startsWith("sentences:"));
    const words = findings.find(l => l.startsWith("words:"));
    return {
        findings,
        sentences: sent ? Number(sent.match(/sentences:\s*(\d+)/)?.[1] ?? NaN) || null : null,
        words: words ? Number(words.match(/words:\s*(\d+)/)?.[1] ?? NaN) || null : null,
        raw: out,
        source,
    };
}
