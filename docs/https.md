# HTTPS / HTTP/2

Hyper listens on two ports:

| Port | Protocol | Who uses it |
|------|----------|-------------|
| `PORT` (3010) | plain HTTP/1.1 | `hyper` CLI, `bun script/repl.ts`, browser extension, FRP tunnel |
| `H2_PORT` (3443) | HTTPS + HTTP/2 | browsers on this Mac and devices on the tailnet |

Why: over HTTP/1.1 Chrome allows 6 connections per origin and every visible tab
keeps one for live updates, so many tabs starve each other. HTTP/2 multiplexes
everything over one connection.

## Default (on)

- The certificate comes from `tailscale cert <mac>.<tailnet>.ts.net` (Let's Encrypt,
  trusted by macOS/iOS as is), renewed on every start. HTTPS Certificates must be
  enabled in the Tailscale admin (DNS page). Without Tailscale a self-signed
  `localhost` certificate is used.
- A browser opening a page on `http://localhost:3010` is redirected (302) to
  `https://<mac>.<tailnet>.ts.net:3443/...`. Only top-level page loads are redirected;
  htmx/fetch, SSE, the extension sidebar, the CLI and tunnel traffic stay on HTTP.
- Loopback-only endpoints (`/procs/repl`, `/external/*`, sidebar bridge) are NOT
  reachable through 3443: the HTTPS listener marks requests as forwarded.

## Switches (env, e.g. in the launchd plist)

```
HYPER_HTTPS=off           # old behaviour: plain HTTP on PORT only, no redirect
HYPER_HTTPS_REDIRECT=off  # keep HTTPS on 3443, but no http:// → https:// redirect
H2_PORT=3443              # HTTPS port
```
