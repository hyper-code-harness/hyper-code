---
name: hyperlet
description: "Publish loopback services through the active system Hyperlet agent to the team VPN. List, status, publish and unpublish use an explicit config or operator descriptor; URLs use the zone derived from its controlPlane, not a fixed deployment domain."
---

# Hyperlet — local services on the team VPN

The default config is `/etc/hyperlet-hn/config.json`, used by the current system agent. There is no fallback to historical user agents. Every function accepts `path` for an explicitly selected installation or a non-secret operator descriptor. Tokens are never read. `controlPlane` must be an HTTPS `control.<zone>` origin; URLs are `https://<service>.<tenant>.in.<zone>`. Unsupported origins fail rather than guessing a domain.

## System-agent permissions

The system config may be root-only. An access error is a setup blocker, not evidence the service is absent. Do not change token permissions, start disabled agents, or write an unrelated user config to make it appear to work.

The operator can enable the CLI's existing `servicesFile` / `stateFile` contract:
1. Configure the **running system agent** with an absolute `servicesFile` in a user-writable directory and an absolute `stateFile` in a directory readable by Hyper. The agent writes the latter with mode 0644. Preserve base `intent.services`, identity, networking and credentials.
2. Provide a readable non-secret descriptor containing the same `controlPlane`, `intent` (including base services), optional `listen`, and exact `servicesFile` / `stateFile` paths. It does not need `tokenFile` and must not contain token values. Keep it aligned with the system config.
3. Pass that descriptor's `path` to all plugin operations. Verify a fresh status report before publishing. A descriptor alone does not reconfigure the daemon.

Changes to system configuration, permissions or services require operator approval. The plugin never performs them. For an explicitly selected user-owned agent without `servicesFile`, the plugin can update that config directly. A root-owned config is never replaced.

## Workflow

1. `hyperlet.status({ path })` and `hyperlet.list({ path })`: inspect the selected agent and its report. Without an explicit path, these use the system default.
2. Start the service bound to `127.0.0.1` on a port ≥1024. Keep it running.
3. `hyperlet.publish({ name: "demo", port: 18765, path })`: verifies the listener, updates only the user manifest (or explicit user-owned config), and waits for the agent report. Return its `url` and confirmation status honestly; writing a manifest does not prove routing.
4. `hyperlet.unpublish({ name: "demo", path })` removes a user-managed service, not the local process.

`servicesFile` contains a JSON array merged by the agent with base `intent.services`. The plugin protects base services from modification/removal. `stateFile` supplies list/status and write confirmation; absent state does not confirm anything. Without those fields, state lives beside the selected config.

## Rules

- Names: lowercase letters, digits and hyphens, starting with a letter, up to 32 characters.
- `kind`: `http` (default), `hyper`, `git`. `scheme`: `http` (default) or `https`.
- `health` defaults to `/`; `wait` defaults to 20 seconds (0–120).
- Listener ownership and policy are enforced by the agent; report refused/down services accurately.
- Never alter existing services unless requested. A base service requires operator changes.
- Access follows the deployment's team VPN policy. Private applications still need their own login.
- `hyperlet.config` is a low-level config reader; do not print its raw config. `hyperlet.write` accepts the full merged service list, preserving base entries, and writes only the mutable portion when `servicesFile` is configured.
