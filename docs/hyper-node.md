# Hyper nodes — sharing LLM access between Hyper instances

An instance keeps two independent sources of models:

- **own providers** — keychain logins, API keys, OAuth (as before);
- **nodes** — other Hyper instances that relay calls through *their* providers.

Both feed one catalogue, so a default model, a fallback chain or an agent may
mix them: `claude-code:claude-opus-5` (own) → `hyper/niquola:claude-opus-5`
(same model, via the node named `niquola`) → `hyper/niquola:gpt-5.4-mini`.
Every instance is a host and a client at the same time.

## Model grammar

`hyper/<node>:<model>` — provider `hyper`, account = node name, model id as the
node lists it. The node name is local (whatever the client called the
connection), so two clients may name the same host differently.

## Wire protocol (host side)

The client builds the provider request **itself** (its own prompt, tools,
reasoning settings) using one of the three wire formats it already speaks; the
host only injects its credential and streams the answer back unchanged.

    GET  /llm/node/v1/models          catalogue: [{ id, api, provider, kind, via? }]
    GET  /llm/node/v1/usage           quota per provider the client may use
    POST /llm/node/v1/anthropic       Anthropic Messages body
    POST /llm/node/v1/responses       OpenAI Responses body (Codex)
    POST /llm/node/v1/chat            OpenAI chat/completions body

Headers: `authorization: Bearer <client token>`, optional `x-hyper-hops`.
The body's `model` names the id from the catalogue; the host maps it to its own
provider, adds the credential and identity headers (Claude Code, Codex CLI), and
proxies the response 1:1 — status, streaming body, `retry-after` and
`*-ratelimit-*` headers — so the client's classifyError parks agents on a 429
exactly as with a native subscription.

Chaining: a host's catalogue may include models it gets from its own nodes
(`via: "hyper/<node>"`), relayed with `x-hyper-hops` incremented; a request
with hops ≥ 3 or one that would go back to the requesting client is refused.

## Access control (host side)

`llm_node_clients`: id, name, sha256(token), hint, allowed providers (empty =
all), created/last used/request count, revoked. The plain token is shown once
in a secure popup. Only loopback and Tailscale (100.64/10) callers, no
forwarded requests. The host logs client, model, status, duration and token
counts — never the prompt.

## Client side

`llm_nodes`: name, url, token (encrypted in local_secrets), enabled, last
catalogue and usage snapshot with fetch time. `resolveEndpoint` answers
`hyper/<node>:<model>` from the cached catalogue (`api`, `kind`), pointing at
`<url>/<api>` with the node token as bearer; the existing stream* functions
need no change. listModels merges node catalogues; listAccounts shows each node
as one row (usage from the node); the LLM page has "Add Hyper node".
