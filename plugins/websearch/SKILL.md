---
name: websearch
description: "Provider-neutral public web search, grounded answers with verified citations, and focused page processing. Use to retrieve ranked links through Brave or Google Browser, answer a question from the live web with quote-level citations, or open a selected public page and apply an LLM instruction to its readable content."
---

# Web Search and Fetch

Use `websearch.search` for ranked public-web links and snippets. It returns one stable result shape across two engines:

- `brave` — direct Brave Search API; fast and suitable for routine retrieval.
- `google-browser` — Google Search through the user's real Chrome; the default engine and useful for independent comparison.

The engine can be selected per call. When omitted, `websearch.defaultEngine` is used. Search is retrieval-only and does not generate an LLM answer.

Use `websearch.fetch` on a selected result URL with a focused prompt. It opens the URL through Browser, captures readable Markdown, and asks an LLM to apply the prompt. The model can be overridden per call; otherwise `websearch.fetchModel` is used, falling back to Hyper's global default model. Authenticated/private pages are not guaranteed; use a specialized plugin for those.

Fetch keeps the evidence, not only the summary: `markdown` holds the readable page as captured and `highlights` the verbatim passages matching the prompt, so a claim can be quoted instead of trusted. Pass `includeMarkdown: false` or `highlights: 0` when only the generated answer is wanted.

## Grounded answers

Use `websearch.answer` when the question matters more than the links. One call searches, reads the top `pages` results as Markdown, and returns `{ answer, citations, sources }`. Each citation carries a `quote` and a `verified` flag: the quote is matched back against the page text it was attributed to, so an invented quote arrives as `verified: false` instead of silently passing. Pass `requireVerified: true` to drop unverifiable citations, and read `sources` to see which pages failed to load.

## Quoting text you already have

`websearch.highlights` scores passages of any text against a query without an LLM — deterministic, no tokens. Use it on page content an agent already fetched, on stored article Markdown, or on a document, instead of asking a model to "find the relevant part".

`websearch.rank` is the same idea with a choice of scoring: `keyword` (default, free), `vector` (embeddings, catches paraphrases that share no words with the query), and `hybrid` (both orderings fused by reciprocal rank — the safe choice when the wording is unpredictable). Vector and hybrid need an embeddings provider; without one they degrade to keyword and report the effective `mode`. `fetch` and `answer` accept the same choice as `rankMode`.

## Reading one page as data

`websearch.read` opens a URL and returns readable Markdown with no LLM involved. It re-snapshots until the extracted length stops growing, so client-rendered pages are not captured half-empty, and it always closes the tab. `fetch` and `answer` both read through it.

## Long pages

`answer` no longer truncates an over-long page at a character limit: it keeps the passages that rank highest for the question, so the relevant section reaches the model even when it sits at the bottom of the page.
