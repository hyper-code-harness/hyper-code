---
name: architecture-map
description: "Summarize Hyper's indexed function call graph as a module dependency map for architecture exploration, coupling review, cycle discovery, and interactive Canvas visualization."
---

# Architecture Map

Use `architectureMap.graph` when you need a compact, module-level view of Hyper's existing `code_functions` and `code_calls` index. It groups runtime functions by namespace, weights dependencies by call-site count, reports incoming and outgoing coupling, and detects module cycles.

The function is read-only. It does not reimplement source parsing; run `code.index` first when the index may be stale. Tests and discarded calls are excluded by default and can be included explicitly.

## Turbulence

Run `architectureMap.indexGit({})` after repository HEADs change. It caches non-merge per-file Git history in Postgres, follows renames, and removes each file's creation commit from churn. Unchanged repository HEADs are served from cache.

Use `architectureMap.turbulence({ root? })` to rank current production files by cached churn and deterministic source complexity. Open `architectureMap.turbulence` on Canvas for the interactive scatter plot and Danger Zone list.
