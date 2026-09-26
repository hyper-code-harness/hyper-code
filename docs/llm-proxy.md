# Claude subscription proxy between Hyper instances

One Claude subscription, one token owner. A second Hyper (another macOS user on
this Mac, or a device on the tailnet) relays its Anthropic calls through the
first one instead of sharing the keychain entry — no refresh-token races.

Host (the instance that owns the Claude Code login):

    settings llm.proxyToken = <random 32+ byte secret>      # or HYPER_LLM_PROXY_TOKEN
    POST /llm/proxy/anthropic/v1/messages   body passes through, streaming included
    GET  /llm/proxy/anthropic/models        ids the host serves

Only loopback and Tailscale (100.64/10) clients are accepted, forwarded requests
are refused, the bearer must match. The host logs model/status/duration per
call, never the prompt.

Client:

    CLAUDE_PROXY_URL=http://<host>:3010/llm/proxy/anthropic
    CLAUDE_PROXY_TOKEN=<the same secret>
    model: claude-proxy:claude-opus-5   (same ids as claude-code:)

`claude-proxy` is a subscription provider: same Claude Code identity headers and
bootstrap prompt as `claude-code`, so gated models behave the same; 429s arrive
with the host's rate-limit headers and park the agent as usual.
