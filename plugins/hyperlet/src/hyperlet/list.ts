import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Lists services this user publishes to the team VPN through Hyperlet, with
 * their https URL, local port, kind and whether the agent saw them up.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent config path. @default "~/.config/hyperlet/config.json" */
    path?: string;
}): Promise<Array<{ name: string; url: string; port: number; kind: string; scheme: string; routed: boolean; up: boolean | null }>> {
    const cfg = await ctx.fns.hyperlet.config({ path: opts.path });
    const file = `${dirname(cfg.path)}/state.json`;
    const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    return cfg.services.map(s => {
        const host = `${s.name}.${cfg.tenant}.in.${cfg.zone}`;
        return { name: s.name, url: `https://${host}`, port: s.port, kind: s.kind, scheme: s.scheme,
            routed: !!report?.hosts?.includes(host), up: report?.ok ? !(report.down ?? []).includes(s.name) && !(report.refused ?? []).includes(s.name) : null };
    });
}
