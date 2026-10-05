# Password authentication

Hyper can require one shared password before exposing the UI and `/api/mobile/v1` through an HTTPS tunnel. Authentication is disabled when no password is configured, preserving local development behavior.

## Configure

Prefer a Bun Argon2 password hash instead of storing plaintext:

```bash
bun -e 'console.log(await Bun.password.hash(process.argv[1]))' 'your-long-password'
```

Set the resulting hash as the secret setting `auth.password` in Hyper Settings, or provide it through:

```bash
HYPER_PASSWORD='$argon2id$...'
```

Plain values are accepted for initial development but are not recommended. Restart or reload the `auth` namespace after changing environment configuration.

## Tunnel

Terminate TLS at the tunnel and forward to `http://127.0.0.1:3010`. The tunnel must send `X-Forwarded-Proto: https`; Hyper then issues a `Secure`, `HttpOnly`, `SameSite=Lax` signed session cookie. Do not expose port 3010 directly to the internet.

Browser requests redirect to `/auth/login`. JSON/mobile requests receive HTTP 401. The native iPhone app displays its password screen and stores the resulting cookie in the shared `URLSession` cookie store.

## Security scope

This is intentionally basic single-user authentication. It provides password verification, signed expiring sessions, secure cookie flags behind HTTPS, no-store auth responses, open-redirect prevention, and origin checks for browser writes. It does not yet provide users, password reset, rate limiting across processes, MFA, revocation of already issued sessions, or fine-grained authorization. Changing the signing key or waiting for expiry invalidates sessions; default session lifetime is 30 days.

# Portal trust (hypermesh)

Every Hyper on hypermesh is reached through the hub (Traefik). On each request the hub asks the control plane (forwardAuth `/v1/net/authz?svc=team/node/service`) whether this person may open this service. With portal trust on, Hyper lets in anyone the hub let through, so access is configured once — in the control plane.

| Setting | Env | Default | Meaning |
|---|---|---|---|
| `auth.portalTrust` | `HYPER_PORTAL_TRUST` | `false` | Turn the mode on. |
| `auth.portalAudience` | `HYPER_PORTAL_AUDIENCE` | — | Expected `aud`, `hn:<team>/<node>/<service>`, e.g. `hn:hr/studio/hyper`. Required. |
| `auth.portalIssuer` | `HYPER_PORTAL_ISSUER` | `https://hn.hyper-mesh.xyz` | Issuer; keys come from its `/.well-known/openid-configuration` `jwks_uri`. |

## Contract

The hub adds `X-Hn-Assertion: <compact JWT>` to each request, signed (RS256 or ES256) with the control plane's OIDC signing keys. Claims: `iss`, `aud`, `sub` (stable person id), `email`, `name`, `iat`, `exp` (at most 120 s ahead), `hn_device`.

Hyper (`auth.portalIdentity`, called first by `auth.currentUser`):

- verifies signature against the issuer's JWKS (`auth.verifyIdToken`), issuer, audience, expiry (5 s skew) and lifetime ≤ 120 s; `alg` must be RS256/ES256 and match the key type;
- finds the user by identity (`provider = oidc`, `subject = sub`, the same row the OIDC button creates), else by email, else creates a **member** — portal users never become owner, even on an empty Hyper;
- refuses disabled users (`users.disabled_at`), re-checked on every request;
- issues no cookie: the assertion is the session for that request, so access ends when the hub stops vouching. A verified assertion is cached until its `exp`.

Never trusted: bare `X-Hn-User` / `X-Hn-*` headers. The hub strips client-supplied `X-Hn-*`, but Hyper's port may be reachable directly, so only the signed assertion counts.

With the mode on and no valid assertion (missing, forged, wrong `aud`, expired, disabled user) Hyper behaves as before: redirect to `/auth/login`, where the OIDC button and password still work. Rejections are logged as `auth.portal.rejected`.
