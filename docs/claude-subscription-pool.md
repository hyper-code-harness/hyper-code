# Shared Claude subscriptions

The picker separates **subscription type → model → account**. An account is a credential and a quota, not a model. When the Claude pool is enabled, selecting an account changes the shared current account on this Hyper instance. Local chats, synthesis, native compaction, and direct inbound Hyper relay requests use it. Each request keeps its chosen model.

## Enable and disable

The declared boolean `llm.claudeSubscriptionPool` is opt-in and defaults to `false`. Configure it through `settings.set` at global scope or the instance's `$settings_llm.json`. It uses connected managed Anthropic OAuth accounts; it does not copy tokens from the CLI or change remote client tokens/ACLs. With the setting disabled, existing provider/account routes retain their old behavior. An enabled pool with no managed OAuth accounts fails closed; it never falls back to CLI credentials.

The current account is durable in `kv` under `llm:claude-pool:current`. Do not edit this row manually. `llm.claudePoolSelect({})` returns non-secret status, retains a healthy current account and chooses the next available one when necessary. `llm.claudePoolSelect({ preferredAccount })` explicitly selects an unspent managed account. Concurrent changes use Postgres compare-and-swap, and account failures have independent cooldown rows so a late success cannot overwrite them.

`llm.claudePoolSelect({ readOnly: true, preferredAccount })` previews and validates a choice without changing shared state (omit `preferredAccount` for status only). The picker uses this mode. New-agent forms apply an explicit shared choice only after agent creation succeeds; if that final selection fails, they report the created agent id and the failure explicitly without scheduling inference. Recover that existing agent by selecting the account again before sending a message; do not blindly resubmit the create form, which would create a duplicate.

Old `claude-code/account:model` and `anthropic-oauth/account:model` routes remain readable, but with the pool enabled their account segment does not pin a subscription. New picker choices are saved as `claude-code:model`, with an optional separate `claudeAccount` submission selecting the shared current credential. API-key Anthropic, other providers, and outbound/chained Hyper routes are unchanged.

## Failover rules

- All local Claude subscription requests and direct incoming relay calls share `llm.fetchClaude`.
- Known spent accounts are skipped before inference. Both five-hour and weekly windows must have quota.
- A confirmed usage-limit response marks the account spent and retries the exact request on the next account. Each account is attempted at most once per request.
- An ordinary 429 is not enough: the helper checks stored headers and, if needed, the authoritative OAuth usage endpoint. Healthy throttled accounts stay current.
- Format errors, authentication failures, outages, successful partial streams, and accepted tool calls are not replayed on another account.
- Managed inference tokens can only go to the Anthropic Messages endpoint; managed quota/profile reads use `https://api.anthropic.com` regardless of `CLAUDE_CODE_BASE_API_URL`. Redirects are rejected on both paths. Credential refresh remains per-account and single-flight.
- When all accounts are exhausted, local workers park Claude chats until the earliest eligible reset. Relay returns quota HTTP 429 with reset/retry information, not a missing-model 404. The catalogue keeps the stable `claude-code` alias for existing provider grants, even with managed-only logins.
- Switching the account does not mutate chat history, reasoning settings, or the model. If all accounts are spent, `llm.call` does not silently move to a different model.

Expired OAuth access tokens remain refreshable; they are not evidence of quota exhaustion. A genuinely revoked login is an authentication error and needs reconnecting. The picker disables durable managed auth failures but not ordinary refreshable token expiry; CLI health for an identically named account does not override managed health. Unknown quota reset times use a one-hour cooldown. This feature does not provide automatic rotation for other subscription types.

## Verification

`src/llm/claudePoolBlockers.test.ts` covers empty-pool fail-closed behavior, read-only previews and failed creation, managed 429 usage refresh origin/redirect constraints, sanitized diagnostics, and picker auth health. `src/llm/fetchClaude.test.ts` also verifies that unpooled 401 refresh exceptions and cancellation close the failed response without replay.

`src/llm/claudePool.test.ts` exercises real isolated Postgres selection, concurrent failures, sticky/manual choice, quota expiry, retry bounds, attribution, streaming, synthesis and compaction. `src/node/claudePoolIntegration.test.ts` uses a real loopback HTTP relay and real test-client authorization with fake encrypted credentials and a mocked upstream. It verifies shared selection, failover, exhaustion, ACL enforcement and no partial-stream replay. Picker tests exercise ordering, deduplication and form behavior in headless Chrome.
