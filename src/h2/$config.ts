// HTTPS + HTTP/2 front door next to the plain HTTP port (see docs/https.md).
//   HYPER_HTTPS=off          old behaviour: plain HTTP on PORT only
//   HYPER_HTTPS_REDIRECT=off keep HTTPS, but do not send browsers from http:// to it
//   H2_PORT                  HTTPS port (default 3443)
export default {
    enabled: { type: "string", default: "on", env: "HYPER_HTTPS" },
    redirect: { type: "string", default: "on", env: "HYPER_HTTPS_REDIRECT" },
    port: { type: "integer", default: 3443, env: "H2_PORT" },
} as const satisfies ConfigSchema;
