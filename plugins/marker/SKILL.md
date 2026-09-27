---
name: marker
description: "Local PDF-to-Markdown conversion with Marker on Apple Silicon, including installation diagnostics, generated artifact inventory, and automatic quality analysis of headings, tables, equations, images, pages, suspicious text, and likely conversion warnings. Use when the user asks to convert or inspect a PDF, make Markdown from a PDF, OCR a local document, benchmark Marker, or analyze conversion quality."
---

# Marker PDF

Runs the locally installed `marker-pdf` CLI without uploading documents. The plugin is optimized for this Mac: it reports PyTorch MPS availability and uses Marker's native device selection.

## Workflow

1. `marker.status({})` checks the executable, Marker/Torch versions, MPS, machine resources, and default output root.
2. `marker.probe({ input })` measures every page's embedded text, computes SHA-256, classifies the PDF, and recommends a mode/device.
3. `marker.convert({ input, mode: "auto", ... })` routes, converts, records provenance, and returns artifacts plus multidimensional quality and review status.
4. `marker.analyze({ markdownPath, sourcePdf? })` re-analyzes an existing result without reconverting.
5. `marker.batch({ inputDir, ... })` processes a directory with checksum resume, a durable index, bounded concurrency, and per-document failures.

Default output is `~/Documents/marker-output/<pdf-name>-<timestamp>/`. Each run writes `marker-run.json` with the source, command options, duration, CLI output tails, generated files, and analysis. Use `outputDir` to choose another destination.

`auto` is the default: digital PDFs use `fast`, fully scanned multi-page PDFs use `ocr` directly on CPU, and mixed/sparse PDFs use `balanced`. `fast` disables OCR and is appropriate only for clean born-digital PDFs. `balanced` lets Marker decide when OCR is necessary. `ocr` forces OCR for image-only or broken-text scans. `useLlm` is deliberately opt-in because it may invoke a configured external or local model and can change privacy/cost characteristics.

The analysis is heuristic, not a semantic ground truth comparison. Review `quality.text`, `quality.layout`, `quality.tables`, `quality.clinicalSafety`, `reviewStatus`, warnings, numeric/unit checks, source-vs-output page counts, and the generated Markdown itself. `manual-verification-required` means extracted clinical numbers must not be promoted to canonical records without source comparison.
