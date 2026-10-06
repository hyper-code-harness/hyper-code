/**
 * Start the http subsystem.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const { port, host } = ctx.fns.procs.config.resolve({ module: "procs/http" }) as ConfigOf<typeof import("./$config").default>;
    const runtimeDir = ctx.fns.procs.project.runtimeDir({});
    await Bun.write(`${runtimeDir}/.keep`, "");
    const logFile = Bun.file(`${runtimeDir}/http.log`).writer();
    ctx.state.procs.http.logFile = logFile;

    const server = Bun.serve({
        // Bun drops a request after 10s by default. The first request that needs
        // a service the supervisor is still bringing up legitimately waits for
        // it, and dying at ten seconds looks like a hang with no line in the log.
        idleTimeout: 120,
        port,
        hostname: host || "0.0.0.0",
        // The whole pipeline lives in procs.http.handle so it hot-reloads; the
        // server passes itself along because a WebSocket upgrade needs it.
        fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }),
        // `$ws_<path>.ts` endpoints: one handler set per server, routed by ws.data.
        websocket: ctx.fns.procs.http.socketHandlers({}) as any,
    });
    // The port the server actually got, not the one that was asked for: `port: 0`
    // means "any free one", and a client reading .runtime/port has no other way
    // to find the process.
    const bound = server.port ?? port;
    ctx.state.procs.http.server = { server, port: bound };
    await Bun.write(`${runtimeDir}/port`, String(bound));
    ctx.fns.procs.log.info({ event: "http.listening", msg: `http://${host && host !== "0.0.0.0" ? host : "localhost"}:${bound}`, port: bound, host, portFile: `${runtimeDir}/port` });
}

// Request handling, logging and WebSocket upgrades live in http/handle.ts.
