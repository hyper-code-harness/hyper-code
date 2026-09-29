import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Reports the Hyperlet agent state for this user: team, node, configured
 * services and the agent's last report to the control plane (ok or error,
 * routed hosts, services that are down locally, ports refused as not owned).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent config path. @default "~/.config/hyperlet/config.json" */
    path?: string;
}): Promise<{ path: string; tenant: string; node: string; services: string[]; report: { at?: string; ok?: boolean; hosts?: string[]; down?: string[]; refused?: string[]; error?: string } | null; ageSeconds: number | null }> {
    const cfg = await ctx.fns.hyperlet.config({ path: opts.path });
    const file = `${dirname(cfg.path)}/state.json`;
    const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const ageSeconds = report?.at ? Math.round((Date.now() - Date.parse(report.at)) / 1000) : null;
    return { path: cfg.path, tenant: cfg.tenant, node: cfg.node, services: cfg.services.map(s => s.name), report, ageSeconds };
}
