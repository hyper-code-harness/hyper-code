# Runtime function search

Runtime function documentation is indexed in Postgres table `functions`.

## Embeddings

`ctx.fns.embeddings.embed({ input })` is provider-neutral. The selected provider is declared by `embeddings.provider`:

- `off` (default): BM25/lexical search only; no network calls.
- `openai`: OpenAI `/v1/embeddings`, using the existing `llm.openaiApiKey` secret.

The configured model is cached with every vector. Provider or model changes invalidate vectors even when function content is unchanged.

## Multilingual retrieval documents

Query-time regex expansion or hard-coded intent translation is forbidden. Instead, indexing builds a durable retrieval document:

1. canonical English metadata from code: name, split camelCase name, summary, docstring, signature, parameter schema;
2. optional locale enrichment (only when `embeddings.locales` is set; empty by default = off, no LLM calls) generated once per changed function: a concise localized description and natural-language search phrases;
3. `search_text` is the canonical and localized text combined;
4. the same combined retrieval document is used by BM25 and embeddings.

Locale enrichment is stored in `functions.localized_text` and keyed by `content_hash + localization_provider + localization_model + locales`. A restart does no localization or embedding work. A code/doc change invalidates only that function. Changing localization model/locales invalidates localization and therefore the vector derived from it.

Localization is an index build concern, not query rewriting. The original user prompt goes unchanged to both BM25 and embedding search.

## Retrieval

1. Fetch BM25 and vector candidates independently (window 60).
2. Keep raw BM25 and cosine evidence.
3. Apply independently calibrated branch gates: a candidate can qualify through strong lexical **or** strong semantic evidence.
4. Use Reciprocal Rank Fusion (`k=60`) only to order the eligible union; RRF is rank aggregation, not an absolute relevance score.
5. Return no result when no branch has adequate evidence.

`runtime.docs.ragBenchmark` evaluates labelled English/Russian positive and no-result prompts and reports Recall@5, no-result precision, and query accuracy for candidate thresholds.

## Lifecycle

`runtime.docs.index({})` snapshots live metadata into `functions`. Content hashes avoid repeated enrichment and embedding. Removed runtime functions are deleted. Indexing is best-effort at boot/reload: unavailable credentials never prevent runtime startup, and search falls back to BM25 or in-memory lexical retrieval.
