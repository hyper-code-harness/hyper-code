---
name: mineru
description: "Local PDF-to-Markdown parsing with MinerU, optimized for Apple Silicon through its MLX-backed VLM engine. Use to convert complex PDFs and scans, inspect MinerU artifacts, or compare MinerU against Marker on the same source document."
---

# MinerU PDF

Runs the isolated `uv tool` installation of MinerU locally. No PDF is uploaded. The default backend is `vlm-engine`, which uses MinerU's MLX integration on Apple Silicon. The plugin preserves Markdown, images, layout PDF, content lists, model JSON, and middle JSON, then applies the shared Marker quality analyzer for a comparable report.

## Workflow

1. `mineru.status({})` verifies the CLI, version, MLX installation, and Apple Silicon.
2. `mineru.convert({ input })` converts one PDF and writes a reproducible `mineru-run.json` manifest.
3. `mineru.compare({ input, markerMarkdownPath? })` runs MinerU and compares its output with an existing Marker result or runs Marker automatically.

Use `backend: "vlm-engine"` for the native Apple Silicon VLM path. `pipeline` is a CPU-oriented fallback with explicit `auto`, `txt`, or `ocr` methods and OCR language selection. `hybrid-engine` can be tested separately but is not the default because its behavior and cost are more complex.

MinerU may generate descriptions of figures in addition to source transcription. Such generated descriptions are useful for search but are not authoritative clinical observations. Every clinically relevant number and conclusion still requires source verification.
