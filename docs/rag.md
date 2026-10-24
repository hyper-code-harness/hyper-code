# Function RAG architecture

## Goal

Function RAG helps an agent discover runtime procedures relevant to the latest user request without mutating the stored transcript. It supports lexical, semantic, multilingual, and exact-name retrieval, can abstain when evidence is weak, and keeps every injected block auditable in the UI.

## Data flow

```text
TypeScript + JSDoc
  → live fn.meta
  → runtime.docs.index
  → localized retrieval text
  → Postgres functions table
      ├─ ParadeDB BM25
      └─ halfvec HNSW

user prompt
  → adaptive runtime.docs.search
      ├─ BM25 first
      ├─ exact-name fast path
      └─ vector search when exact-name confidence is absent
  → branch-specific eligibility
  → RRF ordering
  → top five
  → outgoing LLM message only
  → event audit + ƒ tooltip
```

## Runtime metadata

The function loader parses TypeScript AST and JSDoc and attaches metadata to each live function:

- dotted name and namespace;
- summary and full docstring;
- opts type and JSON parameter schema;
- return type;
- source path and line.

`runtime.docs.get`, `list`, and `search` expose this metadata. Source remains authoritative.

## Durable function index

Migration-created Postgres table `functions` stores one row per live function:

- canonical metadata and `search_text`;
- `localized_text` and localization cache identity;
- `content_hash`;
- `halfvec(1536)` embedding;
- embedding provider/model;
- source location and update time.

Removed runtime functions are deleted during synchronization.

## Retrieval document

The canonical English retrieval document combines the dotted and split camelCase names, summary, full docstring, signature, parameter schema, and parameter descriptions. The embedding is not based on the name alone.

## Index-time localization

Localization happens during indexing, never through query-time regex rewriting.

`llm.localize` uses the configured `llm.defaultModel` (including subscription-backed Codex or Claude providers) to generate Russian retrieval text for each function containing its exact capability, synonyms and grammatical forms, specific requests, broad intents where the function is the correct first operation, and colloquial examples.

Structured JSON Schema output requires `{name, text}`. One function is generated per response, with up to five requests concurrent.

Localization is cached by canonical content hash, provider, prompt/schema version, model, and locales. A code/doc change invalidates only that function; a restart with unchanged identities performs no localization.

## Embeddings

The provider-neutral API is:

```ts
ctx.fns.embeddings.embed({ input, model? })
```

Current implementation uses OpenAI `text-embedding-3-large`, shortened to 1536 dimensions. English and localized retrieval text are embedded together. Vectors are stored as `halfvec(1536)` and indexed with HNSW cosine distance.

The embedding cache identity includes retrieval content, provider, and model. Repeated indexing with no changes performs zero embedding calls.

## BM25

ParadeDB indexes canonical and localized retrieval text. The BM25 expression uses the Russian Snowball stemmer:

```sql
search_text::pdb.simple('stemmer=russian')
```

This handles Russian inflection such as `проверить` versus `проверка` without hand-written intent rules. Query text is passed unchanged through `paradedb.match`.


## Adaptive retrieval

Hybrid retrieval is adaptive rather than a hard BM25-to-vector cascade:

1. BM25 runs first and produces up to 60 candidates.
2. An exact dotted function name takes a fast path and skips query embedding.
3. Otherwise a global vector search retrieves up to 60 candidates. It is global so semantic or cross-language matches cannot be lost merely because BM25 missed them.
4. Candidates pass branch-specific evidence gates:
   - intersection: BM25 >= 3 and cosine >= 0.24;
   - BM25-only: BM25 >= 12;
   - vector-only: cosine >= 0.38.
5. Passing candidates are ordered with Reciprocal Rank Fusion using k=60.
6. Internal tmp.* functions are excluded from agent injection.
7. If nothing passes, retrieval abstains and injects nothing.

RRF combines incompatible ranks; it is not an absolute confidence score. Relevance is decided by the independent branch gates before RRF ordering.

## Lexical fallback

When embeddings are disabled or unavailable, hybrid mode returns BM25 results. If the durable index is unavailable, runtime.docs.search falls back to in-memory lexical matching over live metadata. This keeps discovery operational without an embedding provider, although semantic and multilingual recall is reduced.

## Agent integration

Function RAG is stored per agent in Postgres and defaults to disabled. For enabled agents, agent.functionRag searches using the latest user message and selects at most five compact signatures.

buildLlmRequest appends a relevant_runtime_functions block only to the outgoing LLM request copy. The original messages row and message content remain unchanged.

The exact injected block and function records are saved in event payload metadata. The user bubble renders a function icon; hover/focus exposes rank, RRF, BM25, cosine, and the injected block. Delete controls remain below the bubble.

## Index lifecycle and concurrency

runtime.docs.index uses a process mutex so concurrent callers share one run instead of overwriting each other. Localization is bounded by localizationBatch and saves each completed batch to Postgres. Failures preserve completed work, allowing the next invocation to resume.

A clean cached run over 588 functions currently takes about 0.4 seconds and reports localized: 0 and embedded: 0.

## Benchmark

The current 13-case English/Russian positive and no-result benchmark for adaptive search reports:

- query accuracy: 0.923;
- Recall@5: 1.0;
- no-result precision: 0.75.

The Russian query проверять почту retrieves gmail.list in top five. Three conversational no-result cases abstain; hello how are you currently retrieves skill.hello, accounting for the no-result miss. These metrics are corpus-specific and must be rerun after changing the corpus, localization prompt/model, embedding model, tokenizer, or evidence gates.

## Settings

- embeddings.provider: off or openai;
- embeddings.model: text-embedding-3-large;
- embeddings.dimensions: 1536;
- embeddings.locales: locales for LLM-translated retrieval text, e.g. ru; empty by default = translation off (no LLM calls at indexing, English-only index);
- llm.defaultModel: provider-qualified model used by llm.localize when no override is passed; subscription-backed Codex or Claude models are supported;
- agent.function_rag_enabled: persisted per agent, default false.

Secrets are setting references such as env://OPENAI_API_KEY or an available secret provider reference; raw keys must not be logged or stored in source.
