// `<module>/$ws_<path>.ts` — a WebSocket endpoint. Lives in the route table under
// the pseudo-method `WS`, so matching, `:params` and the one-address-one-owner
// rule are exactly those of `$route_`.
import { bindSelf } from "../boot/load";

/**
 * Load WebSocket endpoint declarations into the runtime route table.
 * @param opts.entries The loader entries to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const routes = (ctx.state.procs.http.routes ??= {});
    for (const entry of opts.entries) {
        const mod = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        const from = `${entry.root}/${entry.rel}`;
        if (!mod || typeof mod !== "object") { console.warn(`[ws] skip (default export must be { open?, message?, close?, upgrade? }): ${from}`); continue; }
        const taken = routes[entry.routePath]?.WS as any;
        if (taken?.from && taken.from !== from) {
            console.error(`[ws] ${entry.routePath} is already ${taken.from} — ${from} is refused (two containers, one address)`);
            continue;
        }
        // Same self-aware ctx a route of a mounted tree gets.
        const endpoint: Record<string, unknown> = { from };
        for (const key of ["upgrade", "open", "message", "close", "drain"]) {
            if (typeof mod[key] === "function") endpoint[key] = bindSelf(mod[key], entry.namespace);
        }
        (routes[entry.routePath] ??= {}).WS = endpoint as any;
        ctx.fns.procs.log.debug({ event: "load.ws", msg: `WS ${entry.routePath}`, from });
    }
}
