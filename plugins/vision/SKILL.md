---
name: vision
description: "Recognize text in images (OCR) locally through pluggable engines: `apple` (macOS Apple Vision, ~0.3 s, line boxes and confidence) and `qwen` (Qwen3-VL-8B in LM Studio, ~5-30 s, most accurate, Markdown tables). Use when the user asks to read text from a screenshot, photo, scan, receipt, invoice or form image. Nothing leaves the machine."
---

# Vision

One API, several local engines selected with `engine`.

- `vision.ocr({ path, engine?: "apple" | "qwen", langs?, level?, prompt? })` — main entry point.
  - `apple` returns `lines` (text, confidence, normalized top-left box and rotated quad), `rows` (lines merged into skew-corrected visual rows, cells joined with ` | `) and `text`.
  - `qwen` returns Markdown `text` (tables as Markdown tables), `model` and `truncated`; `lines`/`rows` are empty.
- `vision.appleOcr({ path, langs, level })` — raw Apple Vision engine (`script/apple-ocr.js` via `osascript -l JavaScript`).
- `vision.qwenOcr({ path, prompt?, model?, maxTokens?, timeoutSeconds?, ensure? })` — raw LM Studio engine; `prompt` can ask for structured fields (JSON) instead of a transcription.
- `vision.ensureModel({ model?, contextLength?, ttlSeconds? })` — idempotent: starts the LM Studio server (localhost only) and loads the model if needed; called automatically by `qwenOcr` (cold start ≈ +4-15 s), call it directly to pre-warm before a batch. Loaded with a 1 h idle TTL so the ~10 GB is released automatically.

## Choosing an engine

| | apple | qwen |
|---|---|---|
| Speed | 0.3-0.5 s/image | 5-30 s/image (≈55-60 tok/s, grows with text) |
| Accuracy | good on print, weak on symbols/tiny text | best tested; exact tables, Cyrillic, handwriting |
| Output | lines + boxes + confidence + rows | Markdown |
| Requirements | macOS only | LM Studio with the model downloaded; server/model auto-started (~10 GB RAM while loaded) |
| Failure mode | symbol swaps (№→Nº, ×→x, ₽→Р, S→5), comma→dot in heavy JPEG, <10 px text lost | may hallucinate or loop on dense pages; check `truncated` |

Use `apple` for quick reads, indexing and screenshots; `qwen` when exact numbers, tables or Russian text matter. Always verify money amounts and identifiers.

## Bench (Sep 2026, M3 Ultra, 7 images)

Skewed synthetic RU invoice, PT card receipt photo, FI medical form, postal form, Russian prose screenshot, spreadsheet screenshot, diagram.

- Qwen3-VL-8B 8-bit (LM Studio): best overall, invoice perfect incl. handwriting line; 12.3 s mean.
- Chandra OCR 2 (MLX): close to qwen, ~18 s, layout HTML output; small Cyrillic slips.
- Apple Vision: 0.4 s, reliable baseline with minor symbol errors.
- GLM-OCR: fast (~4.5 s), perfect receipt, but garbles Russian words — rejected.
- PaddleOCR-VL 1.6: weak Cyrillic, looped on the spreadsheet — rejected.
- MinerU 4 (mineru-kit, advanced tier): good tables, but corrupted amounts/IDs in small text — rejected.

## Setup

- LM Studio: `lms get https://huggingface.co/mlx-community/Qwen3-VL-8B-Instruct-8bit -y` (loading is automatic via `vision.ensureModel`).
- Settings: `vision.lmstudioUrl` (env `VISION_LMSTUDIO_URL`, default `http://localhost:1234/v1`), `vision.qwenModel` (env `VISION_QWEN_MODEL`, default `qwen3-vl-8b-instruct`). Any vision model loaded in LM Studio can be swapped in.
- HEIC/TIFF: `apple` reads them directly; convert for `qwen` (`sips -s format jpeg in.heic --out out.jpg`).
