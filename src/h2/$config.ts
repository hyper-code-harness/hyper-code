// Experimental HTTPS + HTTP/2 front door next to the plain HTTP one.
// H2_PORT=0 turns it off.
export default {
    port: { type: "integer", default: 3443, env: "H2_PORT" },
} as const satisfies ConfigSchema;
