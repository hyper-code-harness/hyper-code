---
name: pdf
description: "Unified private PDF-to-Markdown parser over LiteParse, Marker and MinerU. Inspects page text density, chooses the engine for narrative, laboratory tables, mixed documents, or scans, preserves provenance, reports clinical extraction risk, and can compare both engines. Use whenever the user asks to parse, OCR, convert, inspect, benchmark, or compare a local PDF."
---

# PDF Parser

This is the preferred entry point for local PDF parsing. It wraps the `marker` and `mineru` plugins rather than duplicating their runtimes, and adds a LiteParse fast path for born-digital documents.

Optional local dependencies: LiteParse (`uv tool install liteparse`) for the fast path, `marker-pdf` and `mineru` for OCR/VLM parsing. Each engine degrades to a reported error instead of throwing when it is missing.

## Workflow

1. `pdf.status({})` — which engines are installed and what the routing policy is.
2. `pdf.needsOcr({ input })` — the cheap LiteParse text-layer probe (~20-200 ms for a whole document).
   A `SIMPLE` verdict means the embedded text is worth trusting; `COMPLEX` names the pages that need OCR.
3. `pdf.convert({ input })` — converts through the fast path or a heavy engine and returns one
   normalized result with provenance, quality analysis and `reviewStatus`.

For explicit control, `pdf.inspect` recommends an engine without converting, `pdf.parseLite` runs the
LiteParse-only extraction (also DOCX/XLSX/PPTX), and `pdf.compare` runs Marker and MinerU on the same PDF.

## Auto-routing

- **Fast path first**: `pdf.convert` runs `pdf.needsOcr`; if no page needs OCR and no page has a complex layout, LiteParse produces the Markdown directly (milliseconds instead of minutes). Disable with `skipLiteFastPath: true`, force with `engine: "lite"`.
- Born-digital narrative, reports, prescriptions, ECG text: Marker `auto`/`fast`.
- Laboratory/pathology result tables: MinerU `vlm-engine`, because HTML tables preserve rowspan/colspan and units better.
- Fully scanned documents: MinerU `vlm-engine` by default; use comparison for high-stakes extraction.
- Mixed PDFs: MinerU when most pages are scanned, otherwise Marker balanced.

Routing is heuristic. `reviewStatus: manual-verification-required` means no extracted clinical number should become canonical without checking the source PDF. MinerU VLM figure descriptions may be generated rather than clinician-authored and must retain that provenance.
