---
name: medsearch
description: "Open biomedical literature search through official PubMed/NCBI and Europe PMC APIs — find papers, inspect abstracts and MeSH terms, retrieve related work and open-access full text. Use for medical and life-science evidence discovery."
---

# MedSearch

MedSearch uses the official public NCBI E-utilities and Europe PMC REST APIs. It needs no credentials for ordinary use and does not scrape Google Scholar.

## Workflow

Start with `medsearch.search`, using a focused biomedical query. It defaults to PubMed, returns up to 20 papers, and semantically reranks them with Jev System One. Use `source: "pubmed"` for PubMed query syntax and MeSH, or `source: "europepmc"` for Europe PMC filters and open-access discovery. Then inspect one paper with `medsearch.article`, retrieve similar PubMed records with `medsearch.related`, or request open XML with `medsearch.fullText`.


## Building a useful query

Prefer short English biomedical concepts, not a full conversational question. Combine synonyms with `OR` and separate concepts with `AND`. Start broad; if results are noisy, add exact phrases, fields, MeSH terms or dates. Quotation marks increase precision but reduce recall and can miss different wording.

```ts
await ctx.fns.medsearch.search({
  query: "(\"cold snare polypectomy\"[Title/Abstract]) AND (pain OR perforation OR \"postpolypectomy syndrome\")",
  rankQuery: "Can abdominal pain two days after cold snare removal of a 9 mm colorectal polyp indicate a complication?",
  source: "pubmed",
  minRelevance: 0.5,
});
```

If a long plain-text query returns no results, shorten it to the main concepts and add synonyms rather than quoting the whole sentence. Use `[Title/Abstract]` for focused keyword matching; use MeSH when a stable controlled medical concept is known.

```ts
const found = await ctx.fns.medsearch.search({
  query: "hypertension AND exercise AND mortality",
  source: "pubmed",
  limit: 10,
});
const paper = await ctx.fns.medsearch.article({ pmid: found.papers[0].pmid! });
const related = await ctx.fns.medsearch.related({ pmid: paper.pmid!, limit: 10 });
```

Search retrieves a broader candidate pool before reranking. The default `rerank: "jev"` first performs lexical preselection, then sends one Jev System One request containing one independent relevance question per candidate. Results include `relevanceScore`; by default papers below `minRelevance: 0.3` are removed. The default page returns up to 20 papers and Jev scores up to 40 candidates. Pass the user's natural-language question as `rankQuery` when `query` contains PubMed operators. Use `rerank: "lexical"` for a cheaper deterministic ranking or `rerank: "none"` for exact provider order; `candidateMultiplier` and `jevCandidates` control pool sizes.


Full text is only available for articles deposited in PubMed Central or Europe PMC. Abstract availability does not imply open full text. Medical search results are evidence sources, not personal medical advice; assess study design, date, population and conflicts of interest.
