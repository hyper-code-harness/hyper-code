import { readFileSync, lstatSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";

/**
 * Reads the active system Hyperlet configuration, or an explicit operator-provided
 * config/descriptor. Never reads tokenFile. Derives the service zone from the
 * control.<zone> HTTPS origin; does not guess a zone or fall back to user agents.
 * For root installations use a readable, non-secret descriptor with the same
 * controlPlane, intent, servicesFile and stateFile as the running agent.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Config or non-secret descriptor path; ~/ is expanded. @default "/etc/hyperlet-hn/config.json" */
    path?: string;
}): Promise<{ path: string; zone: string; tenant: string; node: string; listen: string; statePath: string; servicesPath: string | null; services: Array<{ name: string; port: number; scheme: "http" | "https"; kind: "hyper" | "http" | "git"; health: string }>; raw: any }> {
    const supplied = opts.path ?? "/etc/hyperlet-hn/config.json";
    const path = supplied.startsWith("~/") ? `${homedir()}/${supplied.slice(2)}` : supplied;
    let raw;
    try {
        const st = lstatSync(path);
        if (!st.isFile() || ![0, process.getuid?.()].includes(st.uid) || (st.mode & 0o022)) throw new Error("regular owner/root-owned config without group/world write required");
        raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (cause) {
        throw new Error(`Cannot read Hyperlet config ${path}. Ask the operator for a readable non-secret descriptor matching the active system agent, with a user-writable servicesFile and readable stateFile; pass its path explicitly. Do not relax token permissions or start a disabled user agent.`, { cause });
    }
    const intent = raw?.intent;
    if (!intent || intent.version !== 2 || !Array.isArray(intent.services)) throw new Error("Unsupported Hyperlet config (intent v2 expected)");
    const cp = new URL(String(raw.controlPlane));
    if (cp.protocol !== "https:" || cp.username || cp.password || cp.pathname !== "/" || cp.search || cp.hash || !cp.hostname.startsWith("control.")) throw new Error("Hyperlet controlPlane must be an HTTPS control.<zone> origin to derive service URLs");
    const zone = cp.hostname.slice("control.".length);
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(zone)) throw new Error("Invalid Hyperlet controlPlane zone");
    for (const key of ["servicesFile", "stateFile"]) {
        if (raw[key] !== undefined && (typeof raw[key] !== "string" || !isAbsolute(raw[key]))) throw new Error(`${key} must be an absolute path`);
    }
    const servicesPath: string | null = raw.servicesFile ?? null;
    const extra = servicesPath && existsSync(servicesPath) ? JSON.parse(readFileSync(servicesPath, "utf8")) : [];
    if (!Array.isArray(extra)) throw new Error("servicesFile must hold a JSON array of services");
    const services = [...intent.services, ...extra];
    if (new Set(services.map(s => s.name)).size !== services.length || new Set(services.map(s => s.port)).size !== services.length) throw new Error("Hyperlet base and manifest services have conflicting names or ports");
    return { path, zone, tenant: intent.tenant, node: intent.node, listen: raw.listen ?? "", statePath: raw.stateFile ?? `${dirname(path)}/state.json`, servicesPath, services, raw };
}
