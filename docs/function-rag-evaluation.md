# Function RAG retrieval evaluation

## Research conclusions

- RRF combines ranks from heterogeneous retrievers; it deliberately does not calibrate BM25 and vector scores (Elastic documentation).
- `k=60` is a common/default rank constant. One branch alone has maximum score `1/(60+1)=0.01639`; two rank-1 branches yield `0.03279`.
- Dense retrieval always returns neighbours even for irrelevant prompts; sparse retrieval may return no results on vocabulary or language mismatch (Qdrant hybrid-search guidance).
- Therefore no-result gating must inspect branch evidence before/alongside fusion. Treating RRF itself as a universal confidence score is unsafe.
- Thresholds are corpus/model-specific and should be calibrated from labelled queries, not copied from another system.

## Corpus observations

The corpus contains about 586 runtime functions. Embedding input includes function name, split camelCase name, summary, full docstring, signature, and parameter schema. Model: `text-embedding-3-large`, 1536 dimensions.

Clear English operational queries show agreement:

| query | intended top | RRF | BM25 | cosine |
|---|---|---:|---:|---:|
| send a telegram message | telegram.send | .03279 | 18.6 | .474 |
| read only duckdb sql | duckdb.query | .03279 | 25.5 | .752 |
| wait until condition then resume agent | agent.waitForEvent | .03252 | 11.0 | .523 |
| list unread gmail messages | gmail.list | .03279 | 13.7 | .488 |
| create a GitHub issue | gh.createIssue | .03279 | 18.3 | .639 |
| find a place near me | gplaces.nearby | .03279 | 12.7 | .436 |
| read a file with line anchors | files.readHashline | .03252 | 25.6 | .556 |

Conversational/no-action prompts are weak or single-branch:

| query | top | RRF | BM25 | cosine |
|---|---|---:|---:|---:|
| thanks, continue | agent.checkGoal | .029–.032 | ~5 | .16–.27 |
| make this prettier | UI/markdown noise | .016 | one branch | ~.30 |
| Russian: спасибо продолжай | arbitrary | .016 | none | ~.17 |

Cross-language email query is vector-only:

| query | top relevant public function | vector rank | cosine | BM25 |
|---|---|---:|---:|---:|
| проверить почту | gmail.get | 2 | .282 | none |
| проверить почту | gmail.list | 8 | .241 | none |

This is insufficient to confidently infer the exact desired operation. Injecting the top vector neighbour would often inject `tmp.waitForEmail` instead.

## Recommended design

1. Retrieve top 50–60 independently from BM25 and vector search.
2. Apply branch-specific eligibility, preserving raw branch ranks:
   - BM25 branch: include candidates with a corpus-calibrated lexical score.
   - vector branch: include candidates above a corpus-calibrated cosine floor.
3. Fuse eligible candidates with RRF (`k=60`).
4. Gate the whole injection using top-result confidence and ambiguity/margin.
5. Exclude non-public namespaces (`tmp.*`) from agent RAG.
6. Inject only a compact top 3–5, preserving rank/BM25/cosine in the UI audit.
7. Maintain a labelled evaluation set and optimize retrieval metrics (Recall@5, MRR, no-result precision), not hand-picked examples.

Initial calibrated policy for the current corpus (`runtime.docs.ragBenchmark`, 13 labelled cases):

- BM25 and cosine are gated independently; RRF is used only for ordering.
- candidate passes when `BM25 >= 8 OR cosine >= .35`;
- exclude non-public `tmp.*` functions;
- inject at most five candidates in fused RRF order;
- `.35` cosine achieved 0.923 query accuracy, 0.889 Recall@5, and 1.0 no-result precision on the microbenchmark;
- semantic-only results below `.35` are rejected.

This policy intentionally does not solve Russian `проверить почту`; with `text-embedding-3-large` its relevant public Gmail candidates are below `.35`. The current clean retrieval evidence is not strong enough.

## Transcript-mined evaluation set (2026-09-20)

The original 13 cases were hand-written and easy: eight of nine positives restate
a function's own summary, so a lexical retriever passes them by construction.
They measured vocabulary overlap, not intent matching.

The set now also carries cases mined from real agent history. Every user prompt
in `messages` was paired with the `ctx.fns.*` calls the agent made next: 4649
pairs, 443 unambiguous, then filtered by hand — "what the agent called" is not
"what was correct", and prompts that only make sense inside their conversation
were dropped. Negatives come from prompts after which the agent called nothing.

`src/runtime/docs/ragCases.ts` now holds 60 cases: 44 positive, 16 negative,
47 of them transcript-mined. `runtime.docs.ragBenchmark({ mode: "compare" })`
scores plain retrieval and the Jev reranking stage on identical candidate
windows and reports the delta.

| metric | base (best cosine .25) | Jev rerank | delta |
|---|---:|---:|---:|
| query accuracy | 0.550 | **0.667** | +0.117 |
| Recall@5 | 0.523 | 0.545 | +0.022 |
| no-result precision | 0.625 | **1.000** | +0.375 |

### The real finding is the retrieval ceiling

On this harder set the correct function is absent from the entire 20-candidate
window for **16 of 44 positives** — a hard ceiling of 0.636 that no reranker can
lift. Measured against what is actually reachable, recall is 24/28 = **0.857**
for Jev versus 0.822 for the baseline.

So reranking is not the bottleneck; first-stage recall is. Prompts like «запушь
на телефон» → `mobiledev.install`, «когда у нас сегодня визит?» → `gcal.events`
and «поносик - но мало» → `healthrepo.createDiary` share no vocabulary with the
documentation and sit outside the window entirely.

Where Jev does pay is silence: it never injects on a conversational prompt
(precision 1.000 against 0.625), which removes the tax the baseline pays on the
majority of real turns. The `needs_tool` question does that work; the floor is
0.15.

Next moves follow from the ceiling, not from the reranker: widen the candidate
window, and improve the localized retrieval documents for plugin functions whose
summaries never use the words users type.
