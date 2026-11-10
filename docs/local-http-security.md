# Local HTTP security

## Listener defaults

HTTP and HTTPS default to `127.0.0.1`. Explicit listener configuration still takes precedence. Changing the defaults in source does not rebind an already running server: a subsequent restart is required. Do not restart an active instance just to hot-reload request checks.

## Browser requests and optional host checks

The global request guard runs before redirects and route exemptions, regardless of whether a password is configured. A supplied Origin must be a valid HTTP(S) origin matching the request's public origin (including protocol and port). Cross-origin writes and WebSocket handshakes are rejected. Browser writes without Origin but with Fetch Metadata are rejected; a supplied Referer on originless writes must match. Originless clients without browser headers remain supported, so this is not a replacement for CSRF tokens for older browsers that omit all those headers.

`http.checkAllowedHosts` defaults to `false`, by explicit product choice. **DNS rebinding is not prevented by same-origin checking alone when host checks are disabled.** Enable this setting to check request and forwarded hostnames against `http.allowedHosts`, whose default is `["localhost", "127.0.0.1", "[::1]"]`. Entries are exact hostnames, without scheme or port; no wildcards. Bind addresses and the hostname allowlist are separate settings. Host allowlisting does not replace authentication.

For example, an instance settings file `$settings_http.json` can contain:

```json
{
  "checkAllowedHosts": true,
  "allowedHosts": ["localhost", "127.0.0.1", "[::1]", "hyper.example"]
}
```

Only the loopback TCP peer is trusted for public-origin forwarding headers. Local processes remain trusted proxy actors; a reverse proxy must strip untrusted client forwarding headers.

## Initial setup

`/auth/setup` requires a proven loopback TCP peer and no forwarding headers. Unknown peers fail closed. Use direct loopback **HTTP** for setup; the HTTPS forwarding listener and reverse proxies are deliberately not accepted. Setup is exempt from the normal HTTP-to-HTTPS redirect. Repeated and trailing slash aliases receive the same restriction.

## Model HTML

Assistant HTML is parsed and restricted to allowed elements and attributes, both when accepted via `respondHtml` and when displayed from saved events or Markdown output. Event handlers, HTMX attributes, scripts, frames, inline styles and executable URL schemes are not accepted. Model-generated HTML must not receive a trusted-content bypass.

Static SVG diagrams are sanitized separately and displayed as `data:image/svg+xml;base64` images rather than inserted into the page DOM. Existing data SVGs are decoded and sanitized again. SVG scripts, animation, foreign content, styles and external resources are removed; input is bounded to 1 MiB and output to 256 KiB. This preserves static geometry and text, but CSS-dependent diagrams (notably Mermaid) can lose colors and styling. Interactive embedded editors remain blocked; use a separate trusted UI instead.

A strict script CSP is not part of this patch. It requires a separate compatibility review of the application's scripts and HTMX behavior. The changes are defense in depth, not a claim that all possible XSS or unsafe tool execution paths have been audited.

## Server rollout checklist (pending infrastructure review)

This is a proposed checklist, not a record of a deployment. Server-specific addresses, service names and proxy topology must be confirmed with Hypermesh before applying it. No server restart or configuration change is implied by this document.

### Before deployment

1. Inventory the current HTTP/HTTPS listeners, explicit bind overrides, authentication mode and proxy path for each instance. Keep a working SSH session independent of the Hyper UI.
2. Record the installed revision and back up the instance configuration for rollback. Do not replace instance settings with workstation defaults.
3. Confirm the immediate TCP peer seen by Hyper. A same-host loopback proxy can use forwarded origin headers; a container bridge, VPN peer or remote proxy is not loopback merely because it belongs to our infrastructure. Do not work around a mismatch by trusting arbitrary forwarded headers or disabling Origin checks.
4. Confirm that the proxy overwrites client-supplied forwarding headers and passes the correct browser-visible scheme and host, including nonstandard ports. Preserve Origin and WebSocket upgrade headers.
5. Confirm that remote access requires authentication. Neither VPN membership, a loopback backend nor the optional domain list is a replacement for sign-in.
6. Leave `http.checkAllowedHosts` disabled unless explicitly enabling it for that instance. If enabled, inventory every required public and backend hostname first. Turning it on without that list can lock out valid traffic.

### Binding and network topology

- HTTP binding: `HYPER_HTTP_HOST`; HTTPS/HTTP2 binding: `H2_HOST`. Both defaults are `127.0.0.1`.
- Prefer a loopback backend when a reverse proxy runs on the same host and can reach it directly.
- If a service must bind to a VPN address or another interface, configure that explicitly and verify firewall and authentication policy before restarting. Do not automatically restore `0.0.0.0` just to make an old proxy route work.
- Container loopback belongs to the container, not the host. Confirm the actual networking arrangement before choosing a bind address.
- Review both listeners. Closing plain HTTP to the LAN is insufficient if HTTPS remains bound to all interfaces through an explicit override.

### Initial setup through SSH

For an unconfigured remote instance, use a local SSH port forward to the server's direct HTTP listener. This is an example, not a command to run without checking the real port and SSH alias:

```sh
ssh -N -L 127.0.0.1:13010:127.0.0.1:3010 SERVER_ALIAS
```

Then open `http://127.0.0.1:13010/auth/setup`. Substitute the actual remote HTTP port; `3010` is only an example. Do not route this through HTTPS, Hyperlet or a reverse proxy. Verify that the SSH forwarding endpoint is in the same network namespace as the listener and that Hyper sees a loopback peer. Keep the form and submission on the same origin. Close the tunnel after setup. Do not disable the setup guard if this path fails; inspect peer and forwarding headers instead.

### Canary and acceptance checks

Deploy one approved instance first, with a rollback path ready. Restart only with explicit operational approval; hot reload does not rebind listening sockets.

- Check the actual listening addresses after restart, including HTTPS, and verify unintended LAN/public access is closed.
- Check sign-in, session persistence, ordinary navigation, same-origin writes and sign-out through the real public URL.
- Check live updates/SSE and WebSocket connections through the real proxy path, not only direct localhost.
- Check an approved harmless agent/tool action and any required mobile/API/CLI integration. Browser and non-browser clients do not necessarily send the same headers.
- Verify cross-origin writes are rejected even without a password in an isolated test instance. Do not remove authentication on a production instance for this test.
- Verify remote/proxied setup is denied, including repeated/trailing slash variants. Do not submit an actual owner-creation form just to test rejection.
- If host checking is enabled, verify an unknown Host is rejected even when Origin matches that unknown host. If disabled, do not report DNS rebinding as fixed.
- Check ordinary Markdown, stored assistant replies and static diagrams; document lost styling and disabled interactive embeds.

### Rollback

If access breaks, use the independent SSH session to inspect logs and compare bind/proxy settings before changing security checks. Restore the saved configuration or previous approved revision using the instance's normal deployment mechanism, then repeat access checks. Rolling back code can reintroduce the original vulnerabilities; do not silently reopen a public unauthenticated listener. Keep affected instances isolated until the intended protection is restored.

## Verification scope

The implementation was checked with 60 passing tests across HTTP security, auth middleware, HTML sanitization, event rendering and SVG image sanitization (210 assertions). Strict runtime validation/typechecking passed for `http.guardRequest`, `agent.sanitizeHtmlBody`, `agent.sanitizeSvgImage` and `agent.renderEventHtml`; the latter retains an `any` documentation warning. `git diff --check` passed.

These are targeted code checks, not proof of a successful server rollout or a full browser/security audit. Proxy behavior, real listener addresses and end-to-end integrations still require per-instance acceptance checks. The full repository test suite was not run as part of this change.


## Hypermesh infrastructure review

Source: read-only report from the Hypermesh agent, received during this change. These observations were reported by that agent, not independently rechecked by the implementation agent. No deployment was authorized or performed.

### Reported live topology

- VPN ingress: browser → hub Traefik (VPN entrypoint `10.77.0.1:443`) → `https://<node-wg-ip>:<H2_PORT>` with `passHostHeader:true` → Hyperlet TCP forward on the node → loopback HTTPS listener. Public names have the form `hyper.<team>.in.hn.hyper-mesh.xyz`.
- The hub reportedly overwrites incoming client forwarding headers. This must remain true; otherwise loopback TCP forwarding can make untrusted headers appear trusted.
- `hyper-node-1` systemd instances already explicitly set loopback HTTP and HTTPS binds. An example is `PORT=3050`, `H2_PORT=3473`, `HYPER_H2_HTTP1=off`, `HYPER_HTTPS_REDIRECT=off`. These values are examples from the inspected instances, not universal defaults.
- Dojo instances run Hyper in the node container's network namespace, with loopback binds there. Host loopback cannot directly reach that namespace's HTTP listener.
- A second direct ingress path uses a node-local Traefik. Studio/macstudio ingress was not examined in equivalent detail.
- Hypermesh also has wildcard subdomain routers. The current Hyper allowlist supports exact hostnames only: adding a literal `*.domain` entry will not work.

### Open deployment blockers and follow-up

1. **Verify the h2 request context.** A loopback TCP peer at the HTTPS listener does not prove that Bun HTTP `requestIP(req)` can resolve the Request forwarded in-process by h2. The current public-origin helper uses the latter. Therefore successful forwarded-origin handling through the production h2 path is not yet established by the network topology alone. Test the real VPN path before rollout.
2. **Explicit forwarded-header trust needs a separate decision.** SSH forwards, generic TCP relays or tunnels can expose loopback backend connections without stripping client headers. A future opt-in trust setting or authenticated proxy boundary was proposed, but has not been implemented in this patch.
3. **Dojo setup needs a namespace-aware procedure.** The simple host SSH forward example above is insufficient there. Do not introduce a publicly reachable socat relay to make setup work; confirm a temporary private, namespace-aware access method first.
4. **Mac canary needs path verification.** Hypermesh proposed `hyper-design@studio` or `sched@dojo` as candidate canaries, but neither is approved here; first resolve the Mac ingress or Dojo namespace checks respectively.
5. **Rollback must preserve worktrees.** Record revisions and configuration, but do not blindly run `git checkout` over uncommitted server changes. Verify the actual deployment mechanism and clean/dirty state, and preserve local changes before agreeing on rollback commands.

### Suggested waves, not approval

Hypermesh proposed one canary, then `hyper-node-1` instances individually (`marketing`, `cs`, `all`, `cord`), then remaining Dojo and Studio instances, with Git infrastructure last. Exact inventory, owners and availability requirements must be confirmed before scheduling; stale/dead instances must not be treated as rollout targets automatically.

Acceptance should include portal sign-in (`HYPER_PORTAL_TRUST`), assets, SSE, terminal/canvas WebSockets, ordinary UI writes, a harmless approved tool call, and bearer-authenticated CLI access. Also test that forged forwarding headers are overwritten at Traefik and that cross-origin writes fail. Hypermesh reports an existing `scripts/smoke.sh` network suite with 53 checks; it was not run as part of this implementation and does not replace the application-specific checks above.


### Follow-up: h2, setup and rollback

Hypermesh's subsequent read-only investigation resolves part of the h2 uncertainty: Bun `requestIP(new Request(...))` returns null, and h2 constructs such an in-process Request. On this path `publicOrigin` therefore uses the request URL, not trusted forwarded headers. The URL is built from the HTTP/2 authority; Traefik preserves the public authority, so the expected browser Origin should match. This is a code/topology explanation, not an end-to-end acceptance result on deployed new code. Canary checks remain required. Do not alter peer detection to trust forwarded headers without reviewing the consequences.

Hypermesh also confirmed the same Hyperlet TCP → loopback h2 arrangement on Mac Studio. This makes it a candidate for canary testing, not an automatically approved deployment target.

For Dojo, a proposed alternative to creating a relay is running an HTTP client with `docker exec` inside the Hyper container, which shares the node network namespace. A direct request to that namespace's HTTP PORT can reach setup without any extra listener. This is not yet a validated setup recipe: verify the current form fields, authentication/CSRF requirements, configured-state behavior and secret-input handling first. Never put passwords into command arguments, shell history, documentation or agent transcripts; use the encrypted secret tooling and a carefully reviewed stdin flow. Do not run a setup POST merely as a smoke test because it changes account ownership/configuration.

Rollback options also need deployment-specific validation:

- On checkout-based instances, inspect status as the owning user and stop if the worktree is dirty. Record the old revision. Prefer immutable release directories plus an explicitly controlled switch of the active release, where the service supports that arrangement; do not introduce a new deployment mechanism during emergency rollback.
- Hypermesh reports Dojo uses `hn/hyper:latest` and a persistent volume at `/env/hyper`. Saving the old image tag alone is NOT sufficient proof of code rollback: first establish whether startup copies or updates code in that volume, whether image replacement changes the effective checkout, and how its previous revision is preserved. Never delete the volume as a rollback shortcut.
- Hypermesh reports SSH is independent of the Hyper process via Hyperlet/hub. Verify this independent access on the chosen canary before restarting it.


### Confirmed Dojo code ownership and rollback requirements

Hypermesh inspected `env-sched` read-only and confirmed that **Hyper's running code comes from the persistent `/env/hyper` volume, not from the Docker image**. The entrypoint clones the repository only when `package.json` is absent. Later starts preserve that checkout; the image refreshes environment documentation and the `hnenv` plugin, then conditionally installs dependencies and starts `bun src/$main.ts`. Retagging an image therefore cannot roll back this security patch.

Before an approved rollout to each Dojo instance, record:

1. The checkout SHA and clean/dirty status from `/env/hyper`, running Git as the owning `hyper` user. Stop on a dirty checkout and agree how to preserve it; do not bypass ownership protection by operating as root.
2. The container image digest, separately from the code SHA, because the entrypoint/environment plugin still depends on that image.
3. The lockfile hash and dependency-install stamp (`node_modules/.hyper-env-lock.sha`). The entrypoint is reported to reinstall dependencies when its tracked lock/package hashes change.
4. A verified recovery backup where required. Hypermesh reports nightly `hn-env-backup@<team>` jobs, but coverage of `/env/hyper` and restore usability must be checked rather than assumed.

The proposed checkout-based rollout is fetch plus fast-forward to the approved SHA, followed by restart of that one Hyper container. The proposed rollback is restoration of the recorded SHA with `git reset --keep` as the owning user, followed by restart; this is an operational write requiring approval, not a command executed during this review. If local edits appear or Git refuses, stop and preserve them instead of using `--hard`. Dependency restoration must be checked after restart rather than inferred solely from the entrypoint logic.

Hyper agents or auto-update workflows can update the checkout and restart themselves. Before the canary, coordinate a maintenance window that prevents conflicting updates; verify the effective SHA both before and after acceptance checks. Read-only findings on `env-sched` must not be assumed identical on every other team container without inventory confirmation.

