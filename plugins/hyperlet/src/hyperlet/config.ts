import { readFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Reads the local Hyperlet agent configuration of the current OS user.
 *
 * The agent (`hyperlet@<user>`) announces the services listed here to the
 * control plane. Use it to learn the team (tenant), node and the configured
 * services before publishing. The node token is never read.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Agent config path. @default "~/.config/hyperlet/config.json" */
    path?: string;
}): Promise<{ path: string; zone: string; tenant: string; node: string; listen: string; services: Array<{ name: string; port: number; scheme: "http" | "https"; kind: "hyper" | "http" | "git"; health: string }>; raw: any }> {
    const path = opts.path ?? `${homedir()}/.config/hyperlet/config.json`;
    let st;
    try { st = lstatSync(path); } catch { throw new Error(`Hyperlet agent is not configured for this user (${path} missing). Ask the operator to enroll this machine.`); }
    if (!st.isFile() || st.uid !== process.getuid?.()) throw new Error(`${path} must be a regular file owned by this user`);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const intent = raw?.intent;
    if (!intent || intent.version !== 2 || !Array.isArray(intent.services)) throw new Error("Unsupported Hyperlet config (intent v2 expected)");
    return { path, zone: "hs.hyper-mesh.xyz", tenant: intent.tenant, node: intent.node, listen: raw.listen, services: intent.services, raw };
}
