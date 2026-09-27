// HTTPS + HTTP/2 front door next to the plain HTTP port (see docs/https.md).
//   HYPER_HTTPS=off          old behaviour: plain HTTP on PORT only
//   HYPER_HTTPS_REDIRECT=off keep HTTPS, but do not send browsers from http:// to it
//   H2_PORT                  HTTPS port (default 3443)
//   H2_HOST                  HTTPS bind address (default 0.0.0.0)
//   HYPER_H2_HTTP1=off       HTTP/2 only: refuse clients that cannot negotiate h2 via ALPN
export default {
    enabled: { type: "string", default: "on", env: "HYPER_HTTPS" },
    redirect: { type: "string", default: "on", env: "HYPER_HTTPS_REDIRECT" },
    port: { type: "integer", default: 3443, env: "H2_PORT" },
    host: { type: "string", default: "0.0.0.0", env: "H2_HOST" },
    http1: { type: "string", default: "on", env: "HYPER_H2_HTTP1" },
} as const satisfies ConfigSchema;
