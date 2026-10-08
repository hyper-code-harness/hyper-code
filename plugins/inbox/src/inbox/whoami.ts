import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Determines who this Hyper is on the mesh: the relay origin, the address host (agents get <agent id>@host) and the node
 * principal its inbox key is bound as. Settings inbox.relay, inbox.host and inbox.principal win; otherwise all three are
 * derived from the Hyperlet agent config of this machine (controlPlane, tenant, node, its service of kind hyper).
 * Reads only non-secret config fields, never the Hyperlet token. Throws with a clear hint when neither source is available.
 * @param opts.configPaths Hyperlet config files to try, in order. @default ["/etc/hyperlet-hn/config.json", "~/.config/hyperlet-hn/config.json"]
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Hyperlet config files to try, in order. @default ["/etc/hyperlet-hn/config.json", "~/.config/hyperlet-hn/config.json"] */
    configPaths?: string[];
}): Promise<types.inbox.Self> {
    const get = async (key: string) => String(await ctx.fns.settings.getString({ module: "inbox", scopeType: "global", key, fallback: "" }) ?? "").trim();
    const [relay, host, principal] = [await get("relay"), await get("host"), await get("principal")];
    if (relay && host && principal) return { relay: relay.replace(/\/$/, ""), host: host.toLowerCase(), principal, source: "settings" };
    const paths = opts.configPaths ?? ["/etc/hyperlet-hn/config.json", "~/.config/hyperlet-hn/config.json"];
    for (const p of paths) {
        const path = p.startsWith("~/") ? `${homedir()}/${p.slice(2)}` : p;
        let raw: any;
        try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
        const cp = new URL(String(raw?.controlPlane ?? ""));
        const intent = raw?.intent;
        if (!cp.hostname.startsWith("control.") || intent?.version !== 2) continue;
        const zone = cp.hostname.slice("control.".length);
        const svc = (intent.services ?? []).find((s: any) => s.kind === "hyper");
        const derivedHost = svc ? (raw.root ? `${svc.name}.in.${zone}` : `${svc.name}.${intent.tenant}.in.${zone}`) : "";
        const out = { relay: relay || cp.origin, host: (host || derivedHost).toLowerCase(), principal: principal || `spiffe://hn/${intent.tenant}/${intent.node}`, source: "hyperlet" as const };
        if (!out.host) throw new Error(`inbox.whoami: ${path} publishes no service of kind hyper; publish this Hyper (hyperlet.publish) or set inbox.host`);
        return out;
    }
    throw new Error("inbox.whoami: no Hyperlet config found and settings inbox.relay/host/principal are empty; this Hyper must be on Hypermesh (hyperlet) or configured explicitly");
}
