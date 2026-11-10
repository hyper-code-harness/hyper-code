# Node relay capabilities and Claude recovery

The node HTTP relay implements only `anthropic`, `responses`, and `openai` transports. Cursor's local SDK streamer is not an HTTP relay. Sharing Cursor model IDs (including IDs also sold by Claude or Codex) falsely advertised models that the host could not serve.

`node.catalog` now rejects unsupported transports before ID deduplication, both for local endpoints and cached chained nodes. It also rejects the Cursor provider even if an older cache labels its API as a supported transport. Local Cursor listing/streaming and client provider grants are unchanged. `node.relay` already matches both ID and requested API; a stale anthropic request cannot dispatch to Cursor.

Regression coverage: `bun test --timeout 120000 src/node/catalog.test.ts` (4 tests, 7 assertions). The longer timeout accommodates isolated test-context cold boot. Covers local Cursor availability, native Claude/Codex export, Claude disappearance without Cursor fallback, stale cached API collisions, grants/hop limits, and stale request rejection before upstream dispatch. Strict runtime documentation/typecheck validation of `node.catalog` passes; hot reload requires no server restart.

## Incident verification (2026-10-22)

Owner runtime: macstudio port 3010, OS user niquola, default Claude Code account. Existing `Claude Code-credentials` item contained an OAuth object but neither access nor refresh token and an expiry of zero. No environment token/config-directory override was present. No claim is made about what emptied that item.

Hyper-design's `bi` model remains `hyper/macstudio:claude-opus-5-5`. Before refresh its cache advertised Opus through Cursor (70 entries, 43 Cursor). After the fix and the normal `node.refresh({name:"macstudio"})` operation, the actual cache contains 27 entries, no Cursor, no Opus, and no refresh error. No grants or model selections changed. The refresh used a narrow function adapter under hyper-design's OS identity and read its existing encryption key without creating or replacing credentials.

## Recovery still requires owner login

At the user's request, the official `claude auth login --claudeai` was launched once under niquola with HOME=/Users/niquola and CLAUDE_CONFIG_DIR unset, in persistent tmux session `hyper-owner-claude-login`. The authorization URL was sent privately to the parent agent for the user. No authorization code, token, or encryption key belongs in this document. If the CLI requests a one-time code, obtain it through a secret input, not ordinary chat.

After the owner completes login: verify only token presence/expiry metadata, refresh the hyper-design `macstudio` node through its normal refresh function, confirm Opus has its native Claude API/provider again, then perform at most a minimal subscription inference smoke test. Do not switch billing, provider or model to conceal missing authorization. No inference was run during the unauthenticated investigation. Code fixed does not mean service restored while login remains pending.
