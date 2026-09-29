import { writeFileSync, renameSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Atomically replaces the service list in the Hyperlet agent config (0600)
 * and optionally waits for the agent to report the new set to the control
 * plane. Low-level helper behind hyperlet.publish and hyperlet.unpublish.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Full new service list. */
    services: Array<{ name: string; port: number; scheme: "http" | "https"; kind: "hyper" | "http" | "git"; health: string }>;
    /** Seconds to wait for the agent report. @default 20 @minimum 0 @maximum 120 */
    wait?: number;
    /** Agent config path. @default "~/.config/hyperlet/config.json" */
    path?: string;
}): Promise<{ confirmed: boolean; report: any }> {
    const cfg = await ctx.fns.hyperlet.config({ path: opts.path });
    const sorted = [...opts.services].sort((a, b) => a.name < b.name ? -1 : 1);
    const next = { ...cfg.raw, intent: { ...cfg.raw.intent, services: sorted } };
    const tmp = `${cfg.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, cfg.path);
    const written = statSync(cfg.path).mtimeMs;
    const file = `${dirname(cfg.path)}/state.json`;
    const want = sorted.map(s => s.name).sort().join(",");
    const deadline = Date.now() + Math.max(0, Math.min(Number(opts.wait ?? 20), 120)) * 1000;
    let report: any = null;
    while (Date.now() < deadline) {
        await Bun.sleep(1000);
        if (!existsSync(file)) continue;
        report = JSON.parse(readFileSync(file, "utf8"));
        if (Date.parse(report.at) < written) continue;
        if (!report.ok) return { confirmed: false, report };
        const seen = [...(report.services ?? []), ...(report.refused ?? [])].sort().join(",");
        if (seen === want) return { confirmed: true, report };
    }
    return { confirmed: false, report };
}
