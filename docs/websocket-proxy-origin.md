# WebSocket browser origins behind local proxies

## Regression (2026-10-19)

A public HTTPS page could authenticate normally, but its WebSocket handshake was rejected with `403 cross_origin`. A same-host **HTTP** Origin incorrectly passed the origin guard and reached authentication (`401` anonymously).

Actual affected path: local DNS resolved the public name to `127.0.0.1`; local Traefik v3.6.25 terminated TLS on 443 and forwarded to the main HTTP listener at 3010. The h2 listener at 3443 and `h2.wsProxy` were **not** on this path. Other deployments can use different paths; inspect the active routing before changing configuration.

Traefik sets `X-Forwarded-Proto: wss` on TLS WebSocket upgrades (`ws` without TLS), unlike its ordinary HTTP `https`/`http` values. Source: https://github.com/traefik/traefik/blob/v3.6.25/pkg/middlewares/forwardedheaders/forwarded_header.go (`rewrite`). `http.publicOrigin` previously accepted only http/https and fell back to the internal `http` URL for wss. It therefore compared the correct browser HTTPS Origin against the wrong scheme.

## Fix and trust boundary

`http.publicOrigin` maps trusted `wss` to `https` and `ws` to `http` before comparing the browser's HTTP Origin. It still obtains the immediate TCP peer from Bun's server and accepts forwarding metadata **only from loopback** (`127.0.0.1`, `::1`, mapped loopback). Missing peer information or a nonlocal peer cannot authorize a forged public origin.

The local proxy must strip/replace client forwarding metadata. Loopback is a trust boundary, not an authenticated proxy identity: untrusted local processes must not share this boundary. Do not expand it to arbitrary VPN/public peers. No per-domain exceptions, no bypass of CSRF or cookie authentication, and no listener changes were required.

Only supported schemes and a bounded hostname/port authority are used. Comma-separated forwarding values are rejected rather than trusting the leftmost client-controlled value; invalid ports fall back to the internal origin. URL parsing canonicalizes host case and default ports. Existing hostname-only support remains; IPv6 forwarded authorities are not added by this patch. Invalid metadata does not authorize an HTTPS public origin, but ordinary internal same-origin traffic retains the original fallback behavior.

## Tests and application

```sh
bun test src/http/publicOrigin.test.ts src/http/publicOrigin.integration.test.ts src/http/security.test.ts 'src/auth/$middleware.test.ts' src/procs/http/ws.test.ts
```

The new unit regression failed before the patch (wss resolution, wrong-scheme refusal, ambiguous metadata), then passed. The real Bun integration test exercises the guard before cookie authentication, 401 without cookie, 403 for foreign/wrong-scheme Origin, 101 with a valid test cookie and actual WebSocket frames. Existing tests exercise HTTP/1 and the TLS HTTP/1 upgrade proxy. Existing H2 listener code is unchanged.

On the main instance, hot-load `http.publicOrigin`, then run strict docs validation with typechecking. No server/Chrome restart is needed. Public HTTPS probes after reload produced correct anonymous WS401 and wrong-scheme/foreign Origin403. HTTP/2 ordinary requests remain available. An authenticated Google live-view frame check must be reported separately; anonymous handshakes or another agent's canvas are not proof of it.

For other instances, ship only these reviewed source/test/documentation changes through the normal update flow. Check their proxy rewriting policy, actual immediate peer and any comma-valued forwarding chains before deployment. No automatic deployment to hr/marketing/zlata or other owners, no config rewrites, and no commit/push of unrelated local changes.
