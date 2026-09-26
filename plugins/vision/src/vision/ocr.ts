/**
 * Extracts text from an image with a selectable local OCR engine: fast Apple Vision lines or accurate Qwen3-VL Markdown.
 *
 * Main OCR entry point for screenshots, photos, scans, receipts and invoice images. Both engines run locally; nothing leaves the machine.
 *
 * Engine tradeoffs (7-image bench on M3 Ultra: synthetic skewed invoice, PT card receipt photo, FI medical form, postal form, Russian text, spreadsheet screenshot, diagram):
 * - apple (default): macOS Vision.framework via JXA. ~0.3-0.5 s per image, free, no model to load, returns per-line confidence, boxes and rows rebuilt by skew-corrected position (table cells joined with ' | '). Good on printed Russian/English/Portuguese and even neat handwriting. Weak spots: symbol swaps (№→Nº, ×→x, ₽→Р, S→5), decimal comma may turn into a dot in heavy JPEG, text under ~10 px unreliable, no real table structure. macOS only.
 * - qwen: Qwen3-VL-8B via LM Studio (see vision.qwenOcr). Most accurate engine tested, clean Markdown tables, preserves symbols, but ~5-30 s per image (grows with text volume), no boxes/confidence, needs LM Studio with the model loaded (~10 GB RAM), and generative output can hallucinate or loop — check truncated.
 * - Rejected in the bench: GLM-OCR (garbles Russian words), PaddleOCR-VL 1.6 (weak Cyrillic, looped on a spreadsheet), MinerU 4 (corrupted amounts and IDs on small text). Chandra 2 is close to qwen in accuracy but slower (~18 s) and emits layout HTML.
 *
 * Pick apple for quick reads, search indexing, UI/screenshot text and anything interactive; pick qwen for documents where exact numbers, tables or Cyrillic matter. Always double-check money amounts and identifiers.
 * @param opts.path Absolute or server-relative path to the image file (qwen accepts PNG/JPEG/WebP/GIF only).
 * @param opts.engine OCR engine: apple = fast local Vision.framework with boxes; qwen = accurate Qwen3-VL in LM Studio returning Markdown. @default apple
 * @param opts.langs apple only: recognition languages as BCP-47 tags in priority order. Defaults to ru-RU, en-US, pt-PT.
 * @param opts.level apple only: accurate is the neural model with language correction, fast is quicker but weaker. @default accurate
 * @param opts.prompt qwen only: override the transcription instruction, e.g. to extract fields as JSON.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute or server-relative path to the image file (qwen accepts PNG/JPEG/WebP/GIF only). */
        path: string;
        /** OCR engine: apple = fast local Vision.framework with boxes; qwen = accurate Qwen3-VL in LM Studio returning Markdown. @default apple */
        engine?: "apple" | "qwen";
        /** apple only: recognition languages as BCP-47 tags in priority order. Defaults to ru-RU, en-US, pt-PT. */
        langs?: string[];
        /** apple only: accurate is the neural model with language correction, fast is quicker but weaker. @default accurate */
        level?: "accurate" | "fast";
        /** qwen only: override the transcription instruction, e.g. to extract fields as JSON. */
        prompt?: string;
    },
): Promise<{ engine: "apple" | "qwen"; model?: string; path: string; durationMs: number; skewDegrees?: number; lines: types.vision.OcrLine[]; rows: types.vision.OcrRow[]; text: string; truncated?: boolean }> {
    const engine = opts.engine ?? "apple";
    if (engine === "qwen") {
        const q = await ctx.fns.vision.qwenOcr({ path: opts.path, prompt: opts.prompt });
        return { engine, model: q.model, path: q.path, durationMs: q.durationMs, lines: [], rows: [], text: q.text, truncated: q.truncated };
    }
    if (engine !== "apple") throw new Error(`vision.ocr: unsupported engine ${String(engine)}`);
    const raw = await ctx.fns.vision.appleOcr({ path: opts.path, langs: opts.langs, level: opts.level });
    const lines = raw.lines;
    const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
    // Page skew = median slope of line top edges; rows are grouped on shear-corrected center y.
    const slope = median(lines.filter(l => l.quad[1].x - l.quad[0].x > 0.02).map(l => (l.quad[1].y - l.quad[0].y) / (l.quad[1].x - l.quad[0].x)));
    const items = lines.map(l => {
      const cx = l.quad.reduce((a, p) => a + p.x, 0) / 4;
      const cy = l.quad.reduce((a, p) => a + p.y, 0) / 4;
      const h = Math.hypot(l.quad[3].x - l.quad[0].x, l.quad[3].y - l.quad[0].y);
      return { line: l, x: cx, y: cy - slope * cx, h };
    }).sort((a, b) => a.y - b.y);
    const rows: Array<{ y: number; h: number; members: typeof items }> = [];
    for (const it of items) {
      const row = rows.find(r => Math.abs(r.y - it.y) < 0.5 * Math.min(r.h, it.h));
      if (row) { row.members.push(it); row.y = row.members.reduce((a, m) => a + m.y, 0) / row.members.length; }
      else rows.push({ y: it.y, h: it.h, members: [it] });
    }
    rows.sort((a, b) => a.y - b.y);
    const out: types.vision.OcrRow[] = rows.map(r => {
      const cells = r.members.sort((a, b) => a.x - b.x).map(m => m.line.text);
      return { y: Number(r.y.toFixed(4)), cells, text: cells.join(" | ") };
    });
    return {
      engine, path: raw.path, durationMs: raw.durationMs,
      skewDegrees: Number((Math.atan(slope) * 180 / Math.PI).toFixed(2)),
      lines, rows: out, text: out.map(r => r.text).join("\n"),
    };
}
